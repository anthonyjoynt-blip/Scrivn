"use client";

import { useRef } from "react";
import { Arc, Circle, Ellipse, Group, Layer, Line, Rect, Shape, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  type MoistureMap,
  type PaintSurface,
  type WallReading,
  bandColor,
  cellSizePx,
  cellsAlongStroke,
  cellsUnderBrush,
  emptyMoistureMap,
  readingBand,
  floorRuns,
  roomMoisture,
} from "@/lib/moisture";
import {
  type CabinetSymbol,
  type DoorSymbol,
  type FixtureSymbol,
  type FreeCabinet,
  type SketchRoom,
  type SketchSymbol,
  type SketchView,
  type Vertex,
  type WallGeometry,
  cabinetDepthPx,
  roomLabelAnchor,
  clampZoom,
  doorOrientation,
  formatFeetInches,
  freeCabinetSizePx,
  pointOnWall,
  isInsideRoom,
  roomBounds,
  stairFlight,
  stairCeiling,
  symbolWidthPx,
  symbolCentrePx,
  PIXELS_PER_FOOT,
  symbolsInDrawOrder,
  tapFractionOnWall,
  cappedInset,
  wallById,
  wallGripSpan,
  wallHandleRadii,
  wallStrokePx,
  wallsOf,
} from "@/lib/sketch";

/**
 * The drawing surface. Rendering and pointer handling only — every state change is reported upward
 * via callbacks, so this component owns no sketch state of its own.
 *
 * Konva touches `window` at import time, so this must never be server-rendered. SketchEditor.tsx
 * pulls it in with `next/dynamic` and `ssr: false`; importing it directly anywhere else will break
 * the build.
 *
 * ── Touch targets ────────────────────────────────────────────────────────────────────────────
 * Every interactive element is drawn small and hit large: a 2.5px wall line under a 28px invisible
 * strip, a 5px corner dot under a 22px invisible circle. On a phone the visible geometry is far
 * below the ~44px a fingertip covers. `opacity={0}` rather than `visible={false}` is deliberate —
 * an invisible shape still hit-tests, a hidden one does not.
 *
 * Hit sizes are divided by the zoom level so they stay constant *on screen*: zoomed out to 0.3, a
 * 28px world-space strip would be 8 screen pixels and effectively untappable.
 */

/**
 * How faint the other storey is.
 *
 * Higher than it was, because it is drawn OVER the working level now rather than under it — and a
 * dashed hairline at this weight is unmistakably not part of the drawing, where a solid one at the
 * same opacity would read as a wall somebody had started.
 */
const UNDERLAY_OPACITY = 0.4;

/** Dash pattern for an underlay wall, in screen pixels — divided by zoom so it holds its look. */
const UNDERLAY_DASH = [7, 5];

const COLORS = {
  wall: "#1b3a5c",
  fill: "#ffffff",
  fillSelected: "#fbeeda",
  grid: "#eef2f6",
  label: "#1b3a5c",
  muted: "#5b6b7c",
  handle: "#c97a0e",
  selected: "#c97a0e",
  symbol: "#1b3a5c",
  /* A surface picked out for a thumbnail. Deliberately not the selection amber — a thumbnail is a
     picture of the work, and reusing the editor's selection colour would read as "this is selected"
     to anyone who has used the editor. */
  highlightWall: "#c0392b",
  highlightCeiling: "rgba(192, 57, 43, 0.16)",
  cabinet: "#e8eef4",
  // Was #f4f7fa, a 2% step off white — visible on a desktop monitor and invisible on a phone.
  subRoom: "#dfe9f2",
  /*
    Affected floor. A cool blue on purpose: the wall bands run warm (amber to red), so the two
    layers stay separable at a glance even where a wet wall meets a wet floor in the same corner.
  */
  /*
    Affected floor: a light water blue rather than the darker teal it started as. The wash sits over
    the room's own fill and under everything else, so it has to read as water without competing with
    the wall bands drawn on top of it.
  */
  moistureFloor: "#8ecae6",
  /* Affected ceiling. Kept dark against the lighter floor so the hatch stays legible over it. */
  moistureCeiling: "#2f6f8f",
  /* A scope marking — where work applies, which has no severity to grade. */
  scopeMark: "#c97a0e",
};

const HIT = { wall: 28, handle: 22, symbol: 30 };

/**
 * Take a pointer gesture for this node alone, so the room group above does not also start dragging.
 *
 * The room is draggable as a whole, and Konva drags the nearest draggable ancestor of whatever was
 * hit — so without this a corner would resize the room AND slide it at the same time. Handles that
 * already select something get this for free, since selecting cancels the bubble for its own reasons.
 */
const claimGesture = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
  e.cancelBubble = true;
};

/**
 * "break" adds a corner to a wall — the same thing double-tapping does, but as a mode.
 *
 * On a phone the double-tap was unusable: the first tap opened the wall's length prompt, which
 * focused an input and threw up the keyboard, and the second tap never got to mean anything. A mode
 * has no such race — you say what you're doing first, then tap once.
 */
/**
 * `opening` places a DOOR whose `doorType` is "opening" rather than a symbol type of its own.
 *
 * A cased opening or a missing wall is a hole in a wall with a head height — which is exactly what
 * a door is, minus the leaf. Giving it its own symbol type would have duplicated the placement,
 * the drag, the resize and the wall-relative geometry to gain nothing; it is a tool, not a kind.
 */
export type ToolMode = "select" | "door" | "opening" | "window" | "cabinet" | "fixture" | "island" | "break";

/**
 * What a gesture means while moisture mapping.
 *
 * Null is ordinary sketching. Anything else puts the geometry into read-only: the room was drawn
 * once already and this mode exists to annotate it, so corners, wall grips and symbol handles all
 * stand down rather than compete with the brush for the same pixels.
 */
export type MoistureTool = "read" | "paint" | "erase";

/** Brush width on screen, so it stays finger-sized however far the view is zoomed. */
const BRUSH_SCREEN_PX = 18;

export interface SketchCanvasProps {
  rooms: SketchRoom[];
  width: number;
  height: number;
  view: SketchView;
  tool: ToolMode;
  /** Draw each symbol's own size next to it. Off keeps the plan clean on a busy room. */
  showSizes: boolean;
  /**
   * The graph-paper background. On while editing, off in an export.
   *
   * It is an editing aid, in the same category as the selection handles an export already leaves
   * off — and in a plan meant to be traced it is worse than clutter, because a grid line and a wall
   * line are the same thing at a glance, and the estimator's own grid will not agree with it.
   */
  showGrid?: boolean;
  /**
   * The moisture layer, and whether to draw it.
   *
   * Passed alongside the rooms rather than merged into them, which is what makes the clean sketch
   * and the moisture-mapped sketch the same geometry rendered with this flag off and on.
   */
  moisture: MoistureMap;
  showMoisture: boolean;
  /**
   * What the marking layer MEANS, which decides how it is drawn.
   *
   * "moisture" colours each wall by how far above its dry standard it reads. "scope" is the same
   * geometry standing for something else entirely — the run of wall a work item covers — which has
   * no severity, so it draws in one colour with no reading label. Defaults to moisture.
   */
  markStyle?: "moisture" | "scope";
  /**
   * One surface picked out for a thumbnail — see `lib/surfaceThumbnails.ts`.
   *
   * A picture only, never an editing state: it changes nothing about what can be selected or
   * dragged, which is why it is separate from `selectedRoomId` rather than reusing it. Absent for
   * every render except a surface thumbnail.
   */
  highlight?: { roomId: string; wallIds: string[]; surface: "walls" | "ceiling" } | null;
  /**
   * Another storey, drawn faintly underneath the one being worked on so it can be traced over.
   *
   * A separate list rather than a flag on `rooms` because these are not part of the drawing: they
   * take no clicks, own no handles, and contribute nothing to what is being edited. Lower opacity is
   * the whole appearance — same geometry, same renderer — so an upper floor lines up with the one
   * below it exactly, which is the point of tracing.
   */
  underlayRooms?: SketchRoom[];
  /** Null while sketching. Set, and the geometry is read-only — see `MoistureTool`. */
  moistureTool: MoistureTool | null;
  /** Which surface the brush paints. Floor and ceiling share a grid but not a set of cells. */
  paintSurface: PaintSurface;
  /** The reading whose ends can be dragged — only one at a time, or the wall fills with handles. */
  selectedReadingId: string | null;
  /** A wall was tapped in moisture mode — the editor opens its reading form. */
  /** `t` is where along the wall the tap landed, so the mark can be clipped to that stretch. */
  onTapWallForReading: (roomId: string, wallId: string, t: number) => void;
  /**
   * A mark was tapped. Carries the ROOM as well as the mark: a mark belongs to a room, and the two
   * have to be selected together or the panel lists one room's readings while the keyboard acts on
   * another's — which is exactly what made a mark on an unselected room impossible to delete.
   */
  onSelectReading: (roomId: string, readingId: string | null) => void;
  /** A reading's run along its wall changed; both are fractions from the wall's start vertex. */
  onResizeReading: (roomId: string, readingId: string, startT: number, endT: number) => void;
  /** The brush crossed these cells on `paintSurface`. `erase` removes them instead of adding. */
  onPaintFloor: (roomId: string, cells: string[], erase: boolean, surface: PaintSurface) => void;
  selectedRoomId: string | null;
  selectedSymbolId: string | null;
  onViewChange: (view: SketchView) => void;
  onSelectRoom: (roomId: string | null) => void;
  onSelectSymbol: (symbolId: string | null) => void;
  /** The room was dragged; values are the translation applied, not an absolute position. */
  onMoveRoom: (roomId: string, dx: number, dy: number) => void;
  /** A wall was tapped in select mode — the editor opens its length input. */
  onTapWall: (roomId: string, wallId: string, screen: { x: number; y: number }) => void;
  /** A wall was tapped while a symbol tool is active. */
  onPlaceSymbol: (roomId: string, wallId: string, t: number) => void;
  /** A wall was double-tapped — splits it, which is how an L-shape starts. */
  onSplitWall: (roomId: string, wallId: string, t: number) => void;
  /** A wall was dragged sideways; dx/dy is the increment since the last frame, in world pixels. */
  onDragWall: (roomId: string, wallId: string, dx: number, dy: number) => void;
  /** The wall drag finished — the one moment snapping is applied. */
  onDragWallEnd: (roomId: string, wallId: string) => void;
  /** The room's name label was double-tapped — the editor floats a rename box there. */
  onRenameRoom: (roomId: string, screen: { x: number; y: number }) => void;
  onMoveVertex: (roomId: string, vertexId: string, x: number, y: number) => void;
  onRemoveVertex: (roomId: string, vertexId: string) => void;
  /** A symbol was dragged along its wall; `centrePx` is the new centre in wall-local pixels. */
  onMoveSymbol: (roomId: string, symbolId: string, centrePx: number) => void;
  /** A symbol's end handle was dragged; both values are in wall-local pixels. */
  onResizeSymbol: (roomId: string, symbolId: string, centrePx: number, widthPx: number) => void;
  /** Open floor inside a room was tapped while the island tool is active; x/y are room-local pixels. */
  onPlaceIsland: (roomId: string, x: number, y: number) => void;
  onMoveIsland: (roomId: string, islandId: string, x: number, y: number) => void;
  onResizeIsland: (roomId: string, islandId: string, widthPx: number, depthPx: number) => void;
}

export default function SketchCanvas(props: SketchCanvasProps) {
  const { rooms, width, height, view, tool, showSizes, selectedRoomId, selectedSymbolId, moisture, showMoisture, moistureTool, paintSurface, selectedReadingId } = props;
  const markStyle = props.markStyle ?? "moisture";
  const stageRef = useRef<Konva.Stage>(null);
  /** Distance between the two fingers on the previous touchmove, for pinch zoom. */
  const lastPinchDist = useRef<number | null>(null);
  /** The stroke in progress: which room it started in, and where the brush last was. */
  const stroke = useRef<{ roomId: string; last: { x: number; y: number } } | null>(null);

  const painting = moistureTool === "paint" || moistureTool === "erase";
  const brushPx = BRUSH_SCREEN_PX / view.scale;

  /**
   * The room a point falls in, innermost first.
   *
   * A closet drawn inside a bedroom is inside both outlines, and the PM aiming at it means the
   * closet — so the smallest containing room wins rather than whichever happens to come first.
   */
  function roomAtWorld(x: number, y: number): SketchRoom | null {
    let best: SketchRoom | null = null;
    let bestArea = Infinity;
    for (const room of rooms) {
      if (!isInsideRoom(room, x, y)) continue;
      const b = roomBounds(room);
      const area = b.width * b.height;
      if (area < bestArea) {
        best = room;
        bestArea = area;
      }
    }
    return best;
  }

  /**
   * Painting is a drag that is not a pan and not a room move.
   *
   * Handled at the stage rather than per room because a stroke is one continuous gesture over the
   * floor: routing it through each room's own shape would break it at every wall and symbol it
   * crossed. The stage knows the pointer position in world coordinates, which is all a brush needs.
   */
  function beginStroke(e: KonvaEventObject<MouseEvent | TouchEvent>): boolean {
    if (!painting) return false;
    const stage = e.target.getStage();
    const world = stage?.getRelativePointerPosition();
    if (!stage || !world) return false;
    const room = roomAtWorld(world.x, world.y);
    if (!room) return false;

    stage.draggable(false);
    e.evt.preventDefault?.();
    stroke.current = { roomId: room.id, last: world };
    props.onPaintFloor(room.id, cellsUnderBrush(room, world, brushPx), moistureTool === "erase", paintSurface);
    return true;
  }

  function continueStroke(e: KonvaEventObject<MouseEvent | TouchEvent>): boolean {
    const active = stroke.current;
    if (!active || !painting) return false;
    const stage = e.target.getStage();
    const world = stage?.getRelativePointerPosition();
    const room = rooms.find((r) => r.id === active.roomId);
    if (!stage || !world || !room) return false;

    e.evt.preventDefault?.();
    // Along the segment, not just at this point — a fast finger reports positions far apart.
    const cells = cellsAlongStroke(room, active.last, world, brushPx);
    stroke.current = { roomId: active.roomId, last: world };
    if (cells.length > 0) props.onPaintFloor(room.id, cells, moistureTool === "erase", paintSurface);
    return true;
  }

  function endStroke() {
    stroke.current = null;
  }

  /**
   * Pan is the stage dragging itself, and it must only happen when the drag starts on empty
   * background. Konva walks up from the hit node to the nearest draggable ancestor, and the Stage is
   * an ancestor of everything — so without this, a drag begun anywhere would end up panning.
   *
   * Each room group is draggable too and sits below the Stage, so a drag starting inside a room now
   * stops there and moves the room. This still matters for the background: it is what keeps a drag
   * that starts on a room from ALSO panning the view.
   *
   * Set imperatively rather than through React state because Konva reads `draggable` when the drag
   * begins, which is the same tick as the pointerdown that decides it — a state update wouldn't
   * have landed yet.
   */
  function updatePanEligibility(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const stage = stageRef.current;
    if (!stage) return;
    stage.draggable(e.target === stage);
  }

  function handleBackgroundPointer(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    updatePanEligibility(e);
    if (e.target === e.target.getStage()) {
      props.onSelectRoom(null);
      props.onSelectSymbol(null);
    }
  }

  /** Wheel zoom, anchored on the pointer so the point under the cursor stays put. */
  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;

    const oldScale = view.scale;
    const worldPoint = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale };
    const scale = clampZoom(e.evt.deltaY > 0 ? oldScale / 1.08 : oldScale * 1.08);
    props.onViewChange({ scale, x: pointer.x - worldPoint.x * scale, y: pointer.y - worldPoint.y * scale });
  }

  /** Two-finger pinch zoom, anchored on the midpoint between the fingers. */
  function handleTouchMove(e: KonvaEventObject<TouchEvent>) {
    const touches = e.evt.touches;
    const a = touches[0];
    const b = touches[1];
    if (!a || !b) {
      lastPinchDist.current = null;
      return;
    }

    // A pinch is never also a drag — stop any pan the first finger started.
    e.evt.preventDefault();
    stageRef.current?.stopDrag();

    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const previous = lastPinchDist.current;
    lastPinchDist.current = dist;
    if (previous == null || previous === 0) return;

    const stage = stageRef.current;
    const box = stage?.container().getBoundingClientRect();
    if (!stage || !box) return;

    const midpoint = { x: (a.clientX + b.clientX) / 2 - box.left, y: (a.clientY + b.clientY) / 2 - box.top };
    const oldScale = view.scale;
    const worldPoint = { x: (midpoint.x - view.x) / oldScale, y: (midpoint.y - view.y) / oldScale };
    const scale = clampZoom(oldScale * (dist / previous));
    props.onViewChange({ scale, x: midpoint.x - worldPoint.x * scale, y: midpoint.y - worldPoint.y * scale });
  }

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
      onMouseDown={(e) => {
        // A stroke claims the gesture outright; otherwise this is an ordinary tap on the background.
        if (!beginStroke(e)) handleBackgroundPointer(e);
      }}
      onTouchStart={(e) => {
        if (!beginStroke(e)) handleBackgroundPointer(e);
      }}
      onMouseMove={continueStroke}
      onMouseUp={endStroke}
      onMouseLeave={endStroke}
      onTouchMove={(e) => {
        if (!continueStroke(e)) handleTouchMove(e);
      }}
      onTouchEnd={() => {
        endStroke();
        lastPinchDist.current = null;
      }}
      onWheel={handleWheel}
      onDragEnd={(e) => {
        // Only the stage's own drag is a pan; a room's drag also bubbles up here.
        if (e.target === e.target.getStage()) {
          props.onViewChange({ ...view, x: e.target.x(), y: e.target.y() });
        }
      }}
    >
      {props.showGrid !== false && (
        <Layer listening={false}>
          <BackgroundGrid view={view} width={width} height={height} />
        </Layer>
      )}
      <Layer>
        {rooms.map((room) => (
          <RoomShape
            key={room.id}
            room={room}
            rooms={rooms}
            tool={tool}
            showSizes={showSizes}
            moisture={moisture}
            showMoisture={showMoisture}
            moistureTool={moistureTool}
            markStyle={markStyle}
            selectedReadingId={selectedReadingId}
            onTapWallForReading={props.onTapWallForReading}
            onSelectReading={props.onSelectReading}
            onResizeReading={props.onResizeReading}
            zoom={view.scale}
            selected={room.id === selectedRoomId}
            highlight={props.highlight?.roomId === room.id ? props.highlight : null}
            selectedSymbolId={selectedSymbolId}
            onSelectRoom={props.onSelectRoom}
            onSelectSymbol={props.onSelectSymbol}
            onMoveRoom={props.onMoveRoom}
            onTapWall={props.onTapWall}
            onPlaceSymbol={props.onPlaceSymbol}
            onSplitWall={props.onSplitWall}
            onDragWall={props.onDragWall}
            onDragWallEnd={props.onDragWallEnd}
            onRenameRoom={props.onRenameRoom}
            onMoveVertex={props.onMoveVertex}
            onRemoveVertex={props.onRemoveVertex}
            onMoveSymbol={props.onMoveSymbol}
            onResizeSymbol={props.onResizeSymbol}
            onPlaceIsland={props.onPlaceIsland}
            onMoveIsland={props.onMoveIsland}
            onResizeIsland={props.onResizeIsland}
          />
        ))}

        {/*
          The selected mark's drag handles, drawn after EVERY room rather than inside the room that
          owns the mark.

          Rooms are drawn in order, so a sub-room lands on top of its parent — including on top of
          the parent's mark handles. A mark that stops where a closet begins puts its handle exactly
          under the closet's own wall strip, which is 20px wide and drawn later, so the end you most
          need to drag was the one end that could not be grabbed. Hoisting them out puts every
          handle above every room, which is where a grab target belongs.
        */}
        {moistureTool === "read" && selectedReadingId != null && (
          <ReadingHandles
            rooms={rooms}
            moisture={moisture}
            readingId={selectedReadingId}
            markStyle={markStyle}
            zoom={view.scale}
            onResize={props.onResizeReading}
          />
        )}
      </Layer>
      {props.underlayRooms && props.underlayRooms.length > 0 && (
        /*
          The other storey, drawn OVER the one being worked on rather than under it.

          Underneath was the obvious place and it was wrong: a room's fill is opaque white, so the
          moment you drew over the ghosted plan it vanished completely — "my sketch overlaps the
          level above and it disappears". A reference you lose exactly when your work reaches it is
          no reference at all.

          On top it survives, and everything about how it is drawn is there to stop it competing:
          dashed hairlines, no fill, no labels, no symbols, no input. It reads as tracing paper laid
          over the drawing, which is what it is.
        */
        <Layer listening={false} opacity={UNDERLAY_OPACITY}>
          {props.underlayRooms.map((room) => (
            <UnderlayRoom key={`underlay-${room.id}`} room={room} zoom={view.scale} />
          ))}
        </Layer>
      )}
    </Stage>
  );
}

/**
 * Faint graph paper, drawn across whatever region of the world is currently visible so it keeps
 * covering the viewport as the user pans. Purely a depth and motion cue — it carries no scale,
 * since scale is per room.
 */
function BackgroundGrid({ view, width, height }: { view: SketchView; width: number; height: number }) {
  const step = 20;
  const left = Math.floor(-view.x / view.scale / step) * step;
  const top = Math.floor(-view.y / view.scale / step) * step;
  const right = left + width / view.scale + step;
  const bottom = top + height / view.scale + step;

  const lines = [];
  for (let x = left; x < right; x += step) {
    lines.push(<Line key={`v${x}`} points={[x, top, x, bottom]} stroke={COLORS.grid} strokeWidth={1 / view.scale} />);
  }
  for (let y = top; y < bottom; y += step) {
    lines.push(<Line key={`h${y}`} points={[left, y, right, y]} stroke={COLORS.grid} strokeWidth={1 / view.scale} />);
  }
  return <>{lines}</>;
}

/**
 * One room of another storey: its walls, dashed, and nothing else.
 *
 * Deliberately NOT `RoomShape`. That draws fill, name, wall lengths, symbols, cabinets and handles —
 * every one of which competes with the level being worked on, and the fill is what buried this
 * underlay when it sat below. What is useful from a floor above or below is where its walls run; the
 * rest is noise laid over somebody's work. Labels go too, on the same reasoning: a room name that
 * belongs to a different storey sitting among the names of this one is worse than no name at all.
 */
function UnderlayRoom({ room, zoom }: { room: SketchRoom; zoom: number }) {
  return (
    <>
      {wallsOf(room).map((wall) => (
        <Line
          key={wall.id}
          points={[wall.x1, wall.y1, wall.x2, wall.y2]}
          stroke={COLORS.wall}
          /* A hairline, not a wall: real walls are drawn at a true 4" (see `wallStrokePx`), so
             matching that weight would make the other storey look like part of this one. */
          strokeWidth={1.5 / zoom}
          dash={UNDERLAY_DASH.map((d) => d / zoom)}
          lineCap="butt"
          listening={false}
        />
      ))}
    </>
  );
}

function RoomShape({
  room,
  rooms,
  highlight,
  tool,
  showSizes,
  moisture,
  showMoisture,
  moistureTool,
  markStyle,
  selectedReadingId,
  onTapWallForReading,
  onSelectReading,
  onResizeReading,
  zoom,
  selected,
  selectedSymbolId,
  onSelectRoom,
  onSelectSymbol,
  onMoveRoom,
  onTapWall,
  onPlaceSymbol,
  onSplitWall,
  onDragWall,
  onDragWallEnd,
  onRenameRoom,
  onMoveVertex,
  onRemoveVertex,
  onMoveSymbol,
  onResizeSymbol,
  onPlaceIsland,
  onMoveIsland,
  onResizeIsland,
}: {
  room: SketchRoom;
  /** Every room on the plan — a cabinet has to know which sub-rooms stand on its wall. */
  rooms: SketchRoom[];
  tool: ToolMode;
  showSizes: boolean;
  zoom: number;
  selected: boolean;
  selectedSymbolId: string | null;
  markStyle: "moisture" | "scope";
  /** Already narrowed to this room by the caller, or null when this room is not the subject. */
  highlight: { roomId: string; wallIds: string[]; surface: "walls" | "ceiling" } | null;
} & Pick<
  SketchCanvasProps,
  | "moisture"
  | "showMoisture"
  | "moistureTool"
  | "selectedReadingId"
  | "onTapWallForReading"
  | "onSelectReading"
  | "onResizeReading"
  | "onSelectRoom"
  | "onSelectSymbol"
  | "onMoveRoom"
  | "onTapWall"
  | "onPlaceSymbol"
  | "onSplitWall"
  | "onDragWall"
  | "onDragWallEnd"
  | "onRenameRoom"
  | "onMoveVertex"
  | "onRemoveVertex"
  | "onMoveSymbol"
  | "onResizeSymbol"
  | "onPlaceIsland"
  | "onMoveIsland"
  | "onResizeIsland"
>) {
  const walls = wallsOf(room);
  const bounds = roomBounds(room);
  // Guaranteed to be inside the room, unlike the bounding-box centre — see `roomLabelAnchor`.
  const anchor = roomLabelAnchor(room);
  const wallStroke = wallStrokePx(zoom);

  /*
    Dimensions go OUTSIDE the outline on a room too small to hold them.

    Labels sit ~11px inside their wall and the room's name sits in the middle, all at a constant size
    on screen. That is comfortable on a bedroom and impossible on a 4' x 3' closet, where the two
    opposing dimensions and the name all land in the same 36 pixels — which is exactly what a to-
    scale drawing produces for a small room, and what the old per-room scale hid by drawing every
    room at whatever size it was dragged to.

    Outside is the drafting convention for a tight dimension anyway. The threshold is in screen
    pixels, so zooming in tucks them back inside as soon as there is room.
  */
  const labelsOutside = Math.min(bounds.width, bounds.height) * zoom < 70;

  /*
    A wall grip has to stay on its own side of the room, not just within its own wall's length.

    The along-the-wall partition says nothing about how far a grip reaches ACROSS the room. On a
    shallow room — a 3' stair flight is the obvious one — the grips on the two long walls are only a
    few pixels apart, so at their normal size they overlap in the middle and the one drawn later
    steals part of the other. Half the distance to the room's centre keeps each on its own side:
    two grips facing each other across that centre have radii summing to no more than the gap.

    This is a world-space constraint, so it holds at every zoom.
  */
  const gripReach = new Map<string, number>();
  for (const wall of walls) {
    const span = wallGripSpan(room, wall);
    if (!span) continue;
    const at = pointOnWall(wall, span.t);
    gripReach.set(wall.id, Math.hypot(at.x - anchor.x, at.y - anchor.y) / 2);
  }

  function handleWallPointer(wall: WallGeometry, e: KonvaEventObject<MouseEvent | TouchEvent>) {
    /*
      While moisture mapping, a wall is where a reading goes.

      In paint or erase mode this stands aside entirely and lets the event bubble to the stage, which
      owns the brush — a stroke that happens to start over a wall is still a stroke, and stopping it
      here would make the strip a dead band across the middle of the floor.
    */
    if (moistureTool === "paint" || moistureTool === "erase") return;
    if (moistureTool === "read") {
      e.cancelBubble = true;
      // Relative, not absolute: a world coordinate, or the fraction is wrong once the view is panned.
      const at = e.target.getStage()?.getRelativePointerPosition();
      onSelectRoom(room.id);
      if (at) onTapWallForReading(room.id, wall.id, tapFractionOnWall(wall, at.x, at.y));
      return;
    }

    const stage = e.target.getStage();
    // Relative, not absolute: this must be a world coordinate, or every hit is offset once the
    // view is panned or zoomed.
    const world = stage?.getRelativePointerPosition();

    if (tool === "select") {
      // A single tap only selects. Setting the length is a double-tap — see `handleWallLength`.
      // Sharing the single tap between "select this" and "type a number" meant every attempt to
      // grab a door near a wall popped a text field instead.
      //
      // Deliberately NOT cancelled: if the tap turns into a drag it must reach the room group and
      // move the room. This line used to cancel unconditionally, from when the room body owned the
      // drag and starting one from a wall was unwanted. The strips are 28px wide, so on a room
      // shallower than about 4'8" they cover every pixel of it — a 3' stair flight could not be
      // dragged from anywhere, and on bigger rooms it worked or not depending where you grabbed.
      onSelectRoom(room.id);
      onSelectSymbol(null);
      return;
    }

    // Placement tools do consume the gesture: adding a door must not also slide the room.
    e.cancelBubble = true;

    if (!world) return;

    if (tool === "break") {
      onSelectRoom(room.id);
      onSplitWall(room.id, wall.id, tapFractionOnWall(wall, world.x, world.y));
      return;
    }

    onPlaceSymbol(room.id, wall.id, tapFractionOnWall(wall, world.x, world.y));
  }

  /**
   * Double-tap a wall — its strip, its grip, or its measurement — to type its length.
   *
   * Behind a double-tap so that a single tap is free for the thing the user is usually reaching for:
   * selecting a room, or grabbing a door that happens to sit on that wall.
   */
  function handleWallLength(wall: WallGeometry, e: KonvaEventObject<MouseEvent | TouchEvent>) {
    // Lengths are geometry, and geometry is read-only while mapping.
    if (moistureTool !== null) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    const box = stage?.container().getBoundingClientRect();
    onSelectRoom(room.id);
    onTapWall(room.id, wall.id, { x: (box?.left ?? 0) + (pointer?.x ?? 0), y: (box?.top ?? 0) + (pointer?.y ?? 0) });
  }

  /** Double-tapping the name opens a rename box over it. */
  function handleRename(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    // A room's name is part of the sketch, and the sketch is read-only while mapping — same rule as
    // its shape, its walls and its cabinets. It was the last way left to edit the drawing from here.
    if (moistureTool !== null) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    const box = stage?.container().getBoundingClientRect();
    onSelectRoom(room.id);
    onRenameRoom(room.id, { x: (box?.left ?? 0) + (pointer?.x ?? 0), y: (box?.top ?? 0) + (pointer?.y ?? 0) });
  }

  /**
   * A tap on the room's open floor. Normally that just selects the room, but with the island tool
   * active it drops a free-standing cabinet where the finger landed — the one placement in this
   * editor that doesn't go through a wall.
   */
  function handleBodyPointer(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool !== "island") {
      onSelectRoom(room.id);
      return;
    }
    e.cancelBubble = true;
    const world = e.target.getStage()?.getRelativePointerPosition();
    if (!world) return;
    const bounds = roomBounds(room);
    onPlaceIsland(room.id, world.x - bounds.minX, world.y - bounds.minY);
  }

  return (
    /*
      The whole room drags, not just its fill.

      Dragging used to live on the body shape below. That looked equivalent and is not: the body is
      the BOTTOM layer, and every tap-only overlay above it — the 28px wall strips, the wall length
      labels, the room's name — is a hole the drag falls through. On a normal room those holes are
      narrow enough to miss. On a shallow one they are the entire room: a 3' stair flight is 36px
      deep, so the top and bottom wall strips alone (28px each) cover every pixel of it, and it could
      not be dragged anywhere at all. It also made the room's behaviour depend on where you grabbed
      it, which is exactly the "sometimes it works" symptom.

      Konva starts a drag on the nearest draggable ancestor of whatever was hit, so putting it here
      means anything that does not claim the drag for itself passes it up and moves the room. Real
      handles — wall grips, corners, symbols — cancel the bubble so they keep their own gesture. The
      rule a user can hold is now simply: handles resize, everything else moves.

      Konva moves the node itself, so the drag is reported as a translation and the node is snapped
      back: the vertices are the source of truth for where the room is, and letting the node keep its
      own offset would put the two out of step.
    */
    <Group
      /* Read-only while moisture mapping: the room was drawn once, this mode annotates it. */
      draggable={tool !== "island" && moistureTool === null}
      onDragEnd={(e) => {
        /*
          Only the room's OWN drag, never a child's.

          Konva bubbles dragend, so finishing a drag on a corner or a wall grip also runs this
          handler — with `e.target` being that handle. Its x/y are then read as if they were the
          room's translation, and since a handle's coordinates are its position in the sketch rather
          than a delta, the room leapt by the whole distance from the origin and left the viewport.
          Resizing a room threw it off screen on release.

          The body shape used to own this drag and never hit the problem, because a leaf has no
          children whose events could bubble through it.
        */
        if (e.target !== e.currentTarget) return;
        const dx = e.target.x();
        const dy = e.target.y();
        e.target.position({ x: 0, y: 0 });
        if (dx !== 0 || dy !== 0) onMoveRoom(room.id, dx, dy);
      }}
    >
      {/*
        Room body, an arbitrary polygon rather than a rectangle. Drawn with a custom sceneFunc so the
        fill follows the true outline — an L-shaped room filled by its bounding box would paint over
        the notch and read as a rectangle.
      */}
      <Shape
        sceneFunc={(context, shape) => {
          const [first, ...rest] = room.vertices;
          if (!first) return;
          context.beginPath();
          context.moveTo(first.x, first.y);
          for (const v of rest) context.lineTo(v.x, v.y);
          context.closePath();
          context.fillStrokeShape(shape);
        }}
        /* A sub-room sits on top of its parent's fill, so it gets a tint of its own — otherwise a
           closet drawn inside a bedroom is invisible against it. */
        fill={
          highlight?.surface === "ceiling"
            ? COLORS.highlightCeiling
            : selected
              ? COLORS.fillSelected
              : room.parentRoomId
                ? COLORS.subRoom
                : COLORS.fill
        }
        stroke={selected ? COLORS.selected : "transparent"}
        strokeWidth={1 / zoom}
        onMouseDown={(e) => handleBodyPointer(e)}
        onTouchStart={(e) => handleBodyPointer(e)}
      />

      {walls.map((wall) => (
        /* Drawn at a real 4" — see `wallStrokePx`. That also leaves a shared wall room for a mark on
           each side (see `insetTowards`): two adjacent rooms draw their own line over the same
           centreline, which together read as one wall with two faces rather than two coincident
           lines. */
        <Line
          key={wall.id}
          points={[wall.x1, wall.y1, wall.x2, wall.y2]}
          stroke={highlight?.wallIds.includes(wall.id) ? COLORS.highlightWall : COLORS.wall}
          /* Heavier as well as coloured: a thumbnail is read small and printed, sometimes in
             greyscale, where colour alone stops carrying. */
          strokeWidth={highlight?.wallIds.includes(wall.id) ? wallStroke * 2 : wallStroke}
          lineCap="square"
          listening={false}
        />
      ))}

      {showMoisture && <PaintedSurfaces room={room} moisture={moisture} zoom={zoom} />}

      <StairsOverlay room={room} zoom={zoom} />


      {/*
        Invisible tap strips over each wall — see the touch-target note at the top.

        These MUST come before the symbols. Konva hit-tests topmost-first, and a door or window sits
        directly on the wall it belongs to, so a strip drawn above the symbols swallows every tap
        meant for one: placing worked (that selects the new symbol in code) but nothing could ever be
        selected, moved or edited afterwards, because each tap landed on the wall and reopened the
        length prompt instead.
      */}
      {walls.map((wall) => {
        /*
          While marking, a wall's tap target sits on THIS room's side of it.

          Centred, the strips of two rooms sharing a wall overlap completely and the one drawn last
          takes every tap — so a shared wall could only ever be marked from one of its two rooms. On
          its own face, each room answers taps made from inside itself, which is how the neighbouring
          room becomes reachable at all. Outside moisture mode it stays centred: tapping a wall to
          set its length is about the wall, not about a side of it.
        */
        const strip =
          moistureTool === null
            ? { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 }
            : insetTowards(wall.x1, wall.y1, wall.x2, wall.y2, anchor, cappedInset(wall.x1, wall.y1, wall.x2, wall.y2, anchor, WALL_FACE_INSET / zoom));
        return (
        <Line
          key={`hit-${wall.id}`}
          points={[strip.x1, strip.y1, strip.x2, strip.y2]}
          stroke="#000"
          strokeWidth={(moistureTool === null ? HIT.wall : HIT.wall * 0.7) / zoom}
          opacity={0}
          /*
            Tap only — deliberately NOT draggable. Dragging the strip itself meant a pull began with
            a mousedown on the wall, which opened the length prompt over the top of the drag. The
            grab handle below owns dragging, so tapping a wall and pulling a wall are separate
            gestures on separate targets.
          */
          onMouseDown={(e) => handleWallPointer(wall, e)}
          onTouchStart={(e) => handleWallPointer(wall, e)}
          onDblClick={(e) => handleWallLength(wall, e)}
          onDblTap={(e) => handleWallLength(wall, e)}
        />
        );
      })}

      {/*
        Affected walls draw ON TOP of the wall lines — the colour IS the wall, not a note beside it —
        and, critically, AFTER the wall hit strips above.

        They started before the strips, which looked right for painting order and was wrong for
        input: a strip is 28px wide and runs the whole wall, so it sat over the mark's end handles
        and took every drag aimed at them. The mark could be created and selected but never resized.
        Anything the PM is meant to grab has to be drawn later than the strips.
      */}
      {showMoisture && (
        <AffectedWalls
          room={room}
          moisture={moisture}
          zoom={zoom}
          interactive={moistureTool === "read"}
          markStyle={markStyle}
          onSelectReading={onSelectReading}
        />
      )}

      {walls.map((wall) => (
        <WallLabel key={`label-${wall.id}`} wall={wall} zoom={zoom} outside={labelsOutside} onLengthRequest={(e) => handleWallLength(wall, e)} />
      ))}

      {/*
        The room's name, with its own tap target on top.

        The Text itself stays non-listening and an invisible rect carries the events: a single tap
        has to keep selecting the room exactly as tapping anywhere else inside it does, and only the
        double-tap is special. Making the Text listen would have swallowed the single tap.
      */}
      <Text
        x={anchor.x - bounds.width / 2}
        y={anchor.y - 7 / zoom}
        width={bounds.width}
        align="center"
        text={room.name.trim() || "Untitled room"}
        fontSize={13 / zoom}
        fontStyle="bold"
        fill={COLORS.label}
        listening={false}
      />
      <Rect
        x={anchor.x - 60 / zoom}
        y={anchor.y - 11 / zoom}
        width={120 / zoom}
        height={22 / zoom}
        fill="#000"
        opacity={0}
        onMouseDown={(e) => handleBodyPointer(e)}
        onTouchStart={(e) => handleBodyPointer(e)}
        onDblClick={(e) => handleRename(e)}
        onDblTap={(e) => handleRename(e)}
      />

      {/*
        There is deliberately no separate "move" handle here.

        One existed, a + at the room's centre, on the reasoning that a small room leaves little body
        to aim at. In practice the centre of a shallow room is exactly where the two opposing wall
        grips meet, so the handle kept losing the hit test to whichever drew last — it looked like a
        control and did nothing, which is worse than no control at all. Dragging the body already
        moves the room and always has, so the + was never the only way in; it was only ever a second
        way that could not be placed safely. Removed rather than repaired.
      */}
      {selected && moistureTool === null &&
        tool === "select" &&
        walls.map((wall) => (
          <WallGrabHandle
            key={`grab-${wall.id}`}
            wall={wall}
            span={wallGripSpan(room, wall)}
            maxRadius={gripReach.get(wall.id) ?? Infinity}
            zoom={zoom}
            onDrag={(dx, dy) => onDragWall(room.id, wall.id, dx, dy)}
            onDragDone={() => onDragWallEnd(room.id, wall.id)}
            onLengthRequest={(e) => handleWallLength(wall, e)}
          />
        ))}

      {selected && moistureTool === null && <VertexHandles room={room} zoom={zoom} onMoveVertex={onMoveVertex} onRemoveVertex={onRemoveVertex} />}

      {/*
        Symbols are drawn AFTER the room's own handles, so they win the tap where they overlap.

        A door sitting near a corner used to be unreachable: the corner handle was drawn later and
        swallowed it. Between the two, the symbol is the better default — it is small, deliberately
        placed, and the thing being adjusted; a corner is still grabbable from its other wall, and
        the wall grip now moves aside to clear ground of its own (see `wallGripSpan`).
      */}
      {/*
        Everything below is inert while moisture mapping.

        Doors, windows, cabinets and islands each own a draggable pad of their own, so switching off
        the room group's drag never reached them — a cabinet stayed grabbable, and reaching for the
        end of a wall mark next to one moved the cabinet instead. `listening` on the wrapper is the
        one place that covers all of them, now and for anything added here later: they still draw,
        because the map needs to show what is in the room, they just cannot be picked up.
      */}
      <Group listening={moistureTool === null}>
      {/* Doors and windows cut the wall line, so they paint over it and must come after. Base
          cabinets before wall cabinets — see symbolsInDrawOrder. */}
      {symbolsInDrawOrder(room.symbols).map((symbol) => (
        <SymbolShape
          key={symbol.id}
          room={room}
          rooms={rooms}
          symbol={symbol}
          zoom={zoom}
          selected={symbol.id === selectedSymbolId}
          onSelect={() => {
            onSelectRoom(room.id);
            onSelectSymbol(symbol.id);
          }}
          showSizes={showSizes}
          onMove={(centrePx) => onMoveSymbol(room.id, symbol.id, centrePx)}
          onResize={(centrePx, widthPx) => onResizeSymbol(room.id, symbol.id, centrePx, widthPx)}
        />
      ))}

      {room.freeCabinets.map((island) => (
        <FreeCabinetShape
          key={island.id}
          room={room}
          cabinet={island}
          zoom={zoom}
          showSizes={showSizes}
          selected={island.id === selectedSymbolId}
          onSelect={() => {
            onSelectRoom(room.id);
            onSelectSymbol(island.id);
          }}
          onMove={(x, y) => onMoveIsland(room.id, island.id, x, y)}
          onResize={(w, d) => onResizeIsland(room.id, island.id, w, d)}
        />
      ))}
      </Group>
    </Group>
  );
}

/**
 * A wall's length, drawn just inside the wall it measures.
 *
 * Side walls are rotated to read bottom-to-top, the usual convention for a vertical dimension, and
 * placed INSIDE the room rather than outside it. Outside looks tidier on a wide canvas but puts the
 * left wall's label at a negative x on a phone, where it is simply off the edge of the canvas and
 * invisible. Inside is always reachable.
 *
 * (The previous version set `width={0}` on the rotated Text, which made Konva wrap the string into
 * zero available space and render nothing at all — side labels never appeared on any screen size.)
 */
function WallLabel({
  wall,
  zoom,
  outside,
  onLengthRequest,
}: {
  wall: WallGeometry;
  zoom: number;
  /** Put the dimension beyond the wall rather than inside it — see `labelsOutside`. */
  outside: boolean;
  onLengthRequest: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const mid = pointOnWall(wall, 0.5);
  const label = formatFeetInches(wall.lengthFeet);
  const inset = (outside ? -13 : 11) / zoom;

  // The inward normal is the wall direction turned +90° in screen space, which points into the room
  // for a clockwise polygon. Deriving it means the label sits correctly on a wall at any angle,
  // rather than only on the four a rectangle happens to have.
  const dx = (wall.x2 - wall.x1) / (wall.lengthPx || 1);
  const dy = (wall.y2 - wall.y1) / (wall.lengthPx || 1);
  const inward = { x: -dy, y: dx };

  // Keep the text the right way up: past vertical, reading it would mean tilting your head.
  const flip = wall.rotation > 90 || wall.rotation < -90;
  const rotation = flip ? wall.rotation + 180 : wall.rotation;
  const boxWidth = Math.max(40, wall.lengthPx);

  return (
    <Group x={mid.x + inward.x * inset} y={mid.y + inward.y * inset} rotation={rotation}>
      <Text
        x={-boxWidth / 2}
        y={flip ? -14 / zoom : 0}
        width={boxWidth}
        align="center"
        text={label}
        fontSize={11 / zoom}
        fill={COLORS.label}
        listening={false}
      />
      {/* Double-tapping the number is the obvious way to change the number, and matches the
          gesture on the wall itself. */}
      <Rect
        x={-30 / zoom}
        y={-9 / zoom}
        width={60 / zoom}
        height={20 / zoom}
        fill="#000"
        opacity={0}
        onDblClick={onLengthRequest}
        onDblTap={onLengthRequest}
      />
    </Group>
  );
}

/**
 * The grip that pulls a wall.
 *
 * A separate target from the wall's tap strip, because the two gestures were fighting: a pull began
 * with a press on the wall, which fired the tap handler and opened the length prompt on top of the
 * drag. Tap the wall to measure it, drag this to move it.
 *
 * Drawn as a short bar lying along the wall at its midpoint, so it reads as a grab point and stays
 * clear of the corner handles at either end.
 *
 * ── Increments, not totals ───────────────────────────────────────────────────────────────────
 * Konva positions a dragged node from the pointer against the offset captured at drag start, so the
 * value read here is the TOTAL travel since the drag began, not the change since the last frame.
 * Feeding that straight to `dragWall` — which applies a delta — made every frame re-apply the whole
 * journey, and the wall shot away from the finger and resisted being pulled back. The origin is
 * captured on dragstart and the difference taken each frame.
 */
function WallGrabHandle({
  wall,
  span,
  maxRadius,
  zoom,
  onDrag,
  onDragDone,
  onLengthRequest,
}: {
  wall: WallGeometry;
  span: { t: number; clearPx: number } | null;
  /** Half the distance to the move grip, so the two can never overlap — see RoomShape. */
  maxRadius: number;
  zoom: number;
  onDrag: (dx: number, dy: number) => void;
  onDragDone: () => void;
  onLengthRequest: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void;
}) {
  const drag = useRef({ originX: 0, originY: 0, lastX: 0, lastY: 0 });
  // Sits in the longest symbol-free stretch of the wall, not necessarily its middle — see
  // `wallGripSpan`. Null means the wall is too built-up to host one; pull it by its corners.
  if (!span) return null;
  const mid = pointOnWall(wall, span.t);
  const grip = Math.min(wallHandleRadii(span.clearPx, zoom).grip, maxRadius);

  return (
    <Group>
      {/* The bar matches the hit area, so on a short wall it visibly shrinks rather than promising
          more target than there is. */}
      <Group x={mid.x} y={mid.y} rotation={wall.rotation} listening={false}>
        <Rect x={-grip} y={-2.5 / zoom} width={grip * 2} height={5 / zoom} cornerRadius={2.5 / zoom} fill={COLORS.handle} />
      </Group>
      <Circle
        x={mid.x}
        y={mid.y}
        radius={grip}
        fill="#000"
        opacity={0}
        draggable
        onMouseDown={claimGesture}
        onTouchStart={claimGesture}
        onDragStart={(e) => {
          drag.current = { originX: e.target.x(), originY: e.target.y(), lastX: 0, lastY: 0 };
        }}
        onDragMove={(e) => {
          const totalX = e.target.x() - drag.current.originX;
          const totalY = e.target.y() - drag.current.originY;
          const dx = totalX - drag.current.lastX;
          const dy = totalY - drag.current.lastY;
          drag.current.lastX = totalX;
          drag.current.lastY = totalY;
          if (dx !== 0 || dy !== 0) onDrag(dx, dy);
        }}
        onDragEnd={(e) => {
          // The wall's own midpoint is the truth; `dragWall` may have refused part of the travel.
          e.target.position({ x: mid.x, y: mid.y });
          drag.current = { originX: mid.x, originY: mid.y, lastX: 0, lastY: 0 };
          // Snapping happens here and nowhere else — see the note in `dragWall`.
          onDragDone();
        }}
        /*
          Double-tap the grip to type the wall's length. The grip can cover that wall's measurement,
          so it has to offer the same gesture the measurement does, or the number becomes unreachable.
          Konva only fires these when the pointer did not drag, so nothing collides: drag to pull,
          double-tap to type.
        */
        onDblClick={onLengthRequest}
        onDblTap={onLengthRequest}
      />
    </Group>
  );
}

/**
 * A draggable handle on every vertex, however many the room has.
 *
 * Replaces the four fixed corner handles. For a four-vertex room the behaviour is identical — see
 * `moveVertex`, which carries the neighbours along at a right-angled corner so a dragged rectangle
 * stays a rectangle. On a vertex inserted mid-wall there is nothing to carry, so it moves freely and
 * pulls the notch out.
 *
 * Double-tapping a handle removes that vertex, which is the way back out of a shape you didn't mean
 * to make.
 */
function VertexHandles({
  room,
  zoom,
  onMoveVertex,
  onRemoveVertex,
}: {
  room: SketchRoom;
  zoom: number;
  onMoveVertex: (roomId: string, vertexId: string, x: number, y: number) => void;
  onRemoveVertex: (roomId: string, vertexId: string) => void;
}) {
  const walls = wallsOf(room);

  return (
    <>
      {room.vertices.map((vertex: Vertex, index: number) => {
        // A corner's share is the outer third of the shorter wall meeting here — see
        // `wallHandleRadii`, which is what keeps corners and wall grips from fighting.
        const incoming = walls[(index - 1 + walls.length) % walls.length] as WallGeometry;
        const outgoing = walls[index] as WallGeometry;
        const shortest = Math.min(incoming.lengthPx, outgoing.lengthPx);
        const hitRadius = wallHandleRadii(shortest, zoom).corner;

        return (
        <Group key={vertex.id}>
          <Circle x={vertex.x} y={vertex.y} radius={5 / zoom} fill={COLORS.handle} listening={false} />
          <Circle
            x={vertex.x}
            y={vertex.y}
            radius={hitRadius}
            fill="#000"
            opacity={0}
            draggable
            onMouseDown={claimGesture}
            onTouchStart={claimGesture}
            onDragMove={(e) => onMoveVertex(room.id, vertex.id, e.target.x(), e.target.y())}
            onDragEnd={(e) => {
              onMoveVertex(room.id, vertex.id, e.target.x(), e.target.y());
              // The room's vertex list is the truth; snapping and the minimum-wall rule may have
              // refused or adjusted the move, so the handle returns to wherever the vertex ended up.
              e.target.position({ x: vertex.x, y: vertex.y });
            }}
            onDblClick={(e) => {
              e.cancelBubble = true;
              onRemoveVertex(room.id, vertex.id);
            }}
            onDblTap={(e) => {
              e.cancelBubble = true;
              onRemoveVertex(room.id, vertex.id);
            }}
          />
        </Group>
        );
      })}
    </>
  );
}

function SymbolShape({
  room,
  rooms,
  symbol,
  zoom,
  showSizes,
  selected,
  onSelect,
  onMove,
  onResize,
}: {
  room: SketchRoom;
  rooms: SketchRoom[];
  symbol: SketchSymbol;
  zoom: number;
  showSizes: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (centrePx: number) => void;
  onResize: (centrePx: number, widthPx: number) => void;
}) {
  const wall = wallById(room, symbol.wallId);
  if (!wall) return null;

  const len = wall.lengthPx;
  const w = symbolWidthPx(symbol, room, rooms);
  // Not `symbol.t * len` — see symbolCentrePx. A fraction pins the middle, so a wide symbol near a
  // corner hangs past it, which is how a cabinet ends up drawn outside the room. `rooms` is what
  // keeps a cabinet off the stretch of wall a sub-room is standing on.
  const centre = symbolCentrePx(symbol, room, rooms);
  const x0 = centre - w / 2;
  const x1 = centre + w / 2;

  const select = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect();
  };

  /**
   * The tappable area, in the wall's local frame.
   *
   * A door or window IS the wall, so its pad is a band straddling the wall line. A cabinet stands in
   * front of the wall and can be much deeper than a fingertip band — its pad covers the whole block,
   * or the finger-sized minimum, whichever is larger. Without this a deep base cabinet is only
   * tappable along the thin strip where it meets the wall.
   */
  const minPad = HIT.symbol / zoom;
  const pad =
    symbol.type === "cabinet" || symbol.type === "fixture"
      ? { y: -6 / zoom, height: Math.max(minPad, cabinetDepthPx(symbol) + 6 / zoom) }
      : { y: -minPad / 2, height: minPad };

  return (
    <Group x={wall.x1} y={wall.y1} rotation={wall.rotation}>
      {/* Erases the wall beneath the opening. Doors and windows are gaps in the wall, not things
          drawn on top of an unbroken line. Cabinets sit against an intact wall. */}
      {symbol.type !== "cabinet" && symbol.type !== "fixture" && <Rect x={x0} y={-2} width={w} height={4} fill={COLORS.fill} />}

      {symbol.type === "door" && <DoorGlyph door={symbol} room={room} x0={x0} x1={x1} w={w} />}
      {symbol.type === "window" && <WindowGlyph x0={x0} x1={x1} />}
      {symbol.type === "cabinet" && <CabinetGlyph cabinet={symbol} x0={x0} w={w} depth={cabinetDepthPx(symbol)} />}
      {symbol.type === "fixture" && <FixtureGlyph fixture={symbol} x0={x0} w={w} depth={cabinetDepthPx(symbol)} />}

      {/* Selection indicator: a bar along the run the symbol occupies, so it's obvious which one
          is selected and how far it reaches. */}
      {selected && <Line points={[x0, 0, x1, 0]} stroke={COLORS.selected} strokeWidth={4 / zoom} lineCap="round" listening={false} />}

      {/*
        The symbol's own hit pad, finger-sized and draggable. Dragging slides the symbol along its
        wall: local y is forced back to 0 every frame, so it can never leave the wall or hop to a
        different one. Local coordinates work because this lives inside the wall's rotated Group —
        a dragBoundFunc would operate in absolute space and fight that rotation.
      */}
      <Rect
        x={x0}
        y={pad.y}
        width={w}
        height={pad.height}
        fill="#000"
        opacity={0}
        draggable
        onMouseDown={select}
        onTouchStart={select}
        onDragMove={(e) => {
          e.target.y(pad.y);
          onMove(e.target.x() + w / 2);
        }}
        onDragEnd={(e) => {
          e.target.y(pad.y);
          onMove(e.target.x() + w / 2);
        }}
      />

      {showSizes && <SymbolSizeLabel symbol={symbol} x0={x0} width={w} zoom={zoom} />}

      {selected && <SymbolEndHandles x0={x0} x1={x1} zoom={zoom} onResize={onResize} />}
    </Group>
  );
}

/**
 * Drag handles at a symbol's two ends. Dragging an end moves that end only, so a symbol is sized
 * the same way a room is — the opposite end stays put.
 *
 * The hit radius is capped at a third of the symbol's width. At the full finger-sized radius, two
 * handles on a 3'0" door completely cover the door between them: the symbol could be selected and
 * resized but never dragged, because every pointer-down in the middle landed on a handle. Capping
 * guarantees a draggable middle third whatever the symbol's size or the zoom level.
 */
function SymbolEndHandles({ x0, x1, zoom, onResize }: { x0: number; x1: number; zoom: number; onResize: (centrePx: number, widthPx: number) => void }) {
  const width = Math.abs(x1 - x0);
  const hitRadius = Math.min(HIT.handle / zoom, Math.max(7 / zoom, width / 3));

  function commit(newX0: number, newX1: number) {
    const lo = Math.min(newX0, newX1);
    const hi = Math.max(newX0, newX1);
    const width = Math.max(6, hi - lo);
    onResize((lo + hi) / 2, width);
  }

  const handles = [
    { key: "start", x: x0, apply: (v: number) => commit(v, x1) },
    { key: "end", x: x1, apply: (v: number) => commit(x0, v) },
  ];

  return (
    <>
      {handles.map((handle) => (
        <Group key={handle.key}>
          <Circle x={handle.x} y={0} radius={4 / zoom} fill={COLORS.handle} listening={false} />
          <Circle
            x={handle.x}
            y={0}
            radius={hitRadius}
            fill="#000"
            opacity={0}
            draggable
            onMouseDown={claimGesture}
            onTouchStart={claimGesture}
            onDragMove={(e) => {
              e.target.y(0);
              handle.apply(e.target.x());
            }}
            onDragEnd={(e) => {
              e.target.y(0);
              handle.apply(e.target.x());
            }}
          />
        </Group>
      ))}
    </>
  );
}

/**
 * A symbol's own size, drawn beside it.
 *
 * Placed just OUTSIDE the wall, on the opposite side from the wall-length labels (which sit inside
 * the room). That separation is the whole point: a door near the middle of a wall would otherwise
 * print its width on top of that wall's overall measurement, and the two numbers mean different
 * things. Outside is also where dimensions live on a real plan.
 */
function SymbolSizeLabel({ symbol, x0, width, zoom }: { symbol: SketchSymbol; x0: number; width: number; zoom: number }) {
  /*
    Measured from the width being DRAWN rather than looked up again.

    The two used to be computed separately, and a label that disagrees with the box beside it is
    worse than no label: the drawing said one thing and the number said another, and the number is
    what somebody prices from. Deriving it here makes them the same by construction — the scale is
    a constant, so this is the drawn width in another unit.
  */
  const feet = width / PIXELS_PER_FOOT;

  const text = symbol.type === "cabinet" ? `${formatFeetInches(feet)} x ${formatFeetInches(symbol.depthFeet)}` : formatFeetInches(feet);
  // Wide enough for the text at any symbol size, centred on the symbol rather than clipped to it.
  const box = Math.max(width, 70 / zoom);

  return (
    <Text
      x={x0 + width / 2 - box / 2}
      y={-16 / zoom}
      width={box}
      align="center"
      text={text}
      fontSize={10 / zoom}
      fill={COLORS.muted}
      listening={false}
    />
  );
}

/**
 * An island: a cabinet standing in open floor rather than against a wall.
 *
 * Drawn in room coordinates rather than a wall's local frame, because it has no wall to be local
 * to. Same solid/dashed convention as wall cabinets, so a lower island and an upper read the same
 * way here as they do along a run.
 *
 * Dragging moves it freely; the clamp that keeps it inside the room lives in `moveFreeCabinet` so
 * the rule holds wherever a move comes from, not only from this drag handler.
 */
function FreeCabinetShape({
  room,
  cabinet,
  zoom,
  showSizes,
  selected,
  onSelect,
  onMove,
  onResize,
}: {
  room: SketchRoom;
  cabinet: FreeCabinet;
  zoom: number;
  showSizes: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (widthPx: number, depthPx: number) => void;
}) {
  const { width, depth } = freeCabinetSizePx(cabinet, room);
  const bounds = roomBounds(room);
  const x = bounds.minX + cabinet.x;
  const y = bounds.minY + cabinet.y;
  const upper = cabinet.tier === "wall";

  const select = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect();
  };

  const sizeText = cabinet.widthFeet != null && cabinet.depthFeet != null ? `${formatFeetInches(cabinet.widthFeet)} x ${formatFeetInches(cabinet.depthFeet)}` : null;
  // Capped against the smaller side so neither handle can reach the block's centre — see below.
  const handleRadius = Math.min(HIT.handle / zoom, Math.max(7 / zoom, Math.min(width, depth) / 3));

  return (
    <Group>
      <Rect
        x={x}
        y={y}
        width={width}
        height={depth}
        fill={upper ? undefined : COLORS.cabinet}
        stroke={selected ? COLORS.selected : COLORS.symbol}
        strokeWidth={(selected ? 2.5 : 1.5) / zoom}
        dash={upper ? [5 / zoom, 3 / zoom] : undefined}
        draggable
        onMouseDown={select}
        onTouchStart={select}
        onDragMove={(e) => onMove(e.target.x() - bounds.minX, e.target.y() - bounds.minY)}
        onDragEnd={(e) => onMove(e.target.x() - bounds.minX, e.target.y() - bounds.minY)}
      />
      <Text
        x={x}
        y={y + depth / 2 - 6 / zoom}
        width={width}
        align="center"
        text={cabinet.label || "Island"}
        fontSize={10 / zoom}
        fill={COLORS.symbol}
        listening={false}
        ellipsis
        wrap="none"
      />
      {showSizes && sizeText && (
        <Text x={x} y={y + depth + 3 / zoom} width={width} align="center" text={sizeText} fontSize={10 / zoom} fill={COLORS.muted} listening={false} />
      )}

      {/*
        Two handles rather than four: one sets the width, one the depth. An island is axis-aligned,
        so a corner handle would only be doing both of these at once.

        The hit radius is capped against the block's smaller side for the same reason the wall
        symbols' handles are: at the full finger-sized radius the depth handle reaches the middle of
        a shallow island and swallows the drag that should move it, leaving it resizable but
        immovable.
      */}
      {selected && (
        <>
          <IslandHandle x={x + width} y={y + depth / 2} zoom={zoom} hitRadius={handleRadius} onDrag={(px) => onResize(px - x, depth)} axis="x" />
          <IslandHandle x={x + width / 2} y={y + depth} zoom={zoom} hitRadius={handleRadius} onDrag={(py) => onResize(width, py - y)} axis="y" />
        </>
      )}
    </Group>
  );
}

function IslandHandle({ x, y, zoom, hitRadius, axis, onDrag }: { x: number; y: number; zoom: number; hitRadius: number; axis: "x" | "y"; onDrag: (value: number) => void }) {
  return (
    <Group>
      <Circle x={x} y={y} radius={4 / zoom} fill={COLORS.handle} listening={false} />
      <Circle
        x={x}
        y={y}
        radius={hitRadius}
        fill="#000"
        opacity={0}
        draggable
        onMouseDown={claimGesture}
        onTouchStart={claimGesture}
        onDragMove={(e) => {
          // Pin the other axis so each handle changes exactly one dimension.
          if (axis === "x") e.target.y(y);
          else e.target.x(x);
          onDrag(axis === "x" ? e.target.x() : e.target.y());
        }}
        onDragEnd={(e) => {
          if (axis === "x") e.target.y(y);
          else e.target.x(x);
          onDrag(axis === "x" ? e.target.x() : e.target.y());
        }}
      />
    </Group>
  );
}

/** The short ticks that close an opening off from the rest of the wall. */
function Jambs({ x0, x1 }: { x0: number; x1: number }) {
  return (
    <>
      <Line points={[x0, -3, x0, 3]} stroke={COLORS.symbol} strokeWidth={2} listening={false} />
      <Line points={[x1, -3, x1, 3]} stroke={COLORS.symbol} strokeWidth={2} listening={false} />
    </>
  );
}

/**
 * Doors, in the four plan conventions an estimator expects. All are drawn in the wall's local frame
 * (+x along the wall, +y into the room), and all honour `flipped`, which mirrors the door about the
 * centre of its opening — the hinge jamb for a swing, the pocket side for a pocket, the stack side
 * for a bifold, the fixed panel for a slider.
 */
function DoorGlyph({ door, room, x0, x1, w }: { door: DoorSymbol; room: SketchRoom; x0: number; x1: number; w: number }) {
  // A missing wall: the opening is cut, the jambs are marked, and nothing swings.
  if (door.doorType === "opening") return <Jambs x0={x0} x1={x1} />;

  const double = door.leaves === "double";
  // The two world-space mirrors resolved into what the glyph needs on this particular wall.
  const { hingeAtEnd, swingReversed } = doorOrientation(door, room);
  // +1 draws on the room side of the wall, -1 on the far side. Local +y points into the room, so
  // reversing the swing is simply a mirror about the wall line.
  const side = swingReversed ? -1 : 1;

  if (door.doorType === "swing") {
    /*
     * Konva's Arc sweeps clockwise from `rotation`, with 0° = +x, 90° = +y (down), 180° = -x,
     * 270° = -y. Each combination of hinge jamb and swing side is therefore a different start
     * angle rather than a mirrored shape — hence the table rather than a sign flip.
     *
     *   into room, hinge at opening start  →  0°      out of room, hinge at start  →  270°
     *   into room, hinge at opening end    →  90°     out of room, hinge at end    →  180°
     */
    const startAngle = (atStart: boolean) => (swingReversed ? (atStart ? 270 : 180) : atStart ? 0 : 90);

    // A double swing is two half-width leaves hinged at opposite jambs, meeting in the middle.
    const leaves = double
      ? [
          { hinge: x0, radius: w / 2, rotation: startAngle(true) },
          { hinge: x1, radius: w / 2, rotation: startAngle(false) },
        ]
      : [{ hinge: hingeAtEnd ? x1 : x0, radius: w, rotation: startAngle(!hingeAtEnd) }];

    return (
      <>
        {leaves.map((leaf, i) => (
          <Group key={i}>
            <Line points={[leaf.hinge, 0, leaf.hinge, leaf.radius * side]} stroke={COLORS.symbol} strokeWidth={2} listening={false} />
            <Arc x={leaf.hinge} y={0} innerRadius={leaf.radius} outerRadius={leaf.radius} angle={90} rotation={leaf.rotation} stroke={COLORS.symbol} strokeWidth={1.5} listening={false} />
          </Group>
        ))}
        <Jambs x0={x0} x1={x1} />
      </>
    );
  }

  if (door.doorType === "pocket") {
    // The leaf disappears into a cavity inside the wall, so the pocket is drawn dashed (hidden
    // construction) and the visible part of the leaf solid.
    const pockets = double
      ? [
          { from: x0, to: x0 - w / 2 },
          { from: x1, to: x1 + w / 2 },
        ]
      : hingeAtEnd
        ? [{ from: x1, to: x1 + w }]
        : [{ from: x0, to: x0 - w }];

    return (
      <>
        {pockets.map((pocket, i) => (
          <Rect
            key={i}
            x={Math.min(pocket.from, pocket.to)}
            y={-3}
            width={Math.abs(pocket.to - pocket.from)}
            height={6}
            stroke={COLORS.symbol}
            strokeWidth={1}
            dash={[4, 3]}
            listening={false}
          />
        ))}
        {/* The leaf itself, shown withdrawn into the opening. */}
        <Rect x={x0} y={-1.5} width={double ? w / 2 : w} height={3} fill={COLORS.symbol} listening={false} />
        {double && <Rect x={x0 + w / 2} y={-1.5} width={w / 2} height={3} fill={COLORS.symbol} listening={false} />}
        <Jambs x0={x0} x1={x1} />
      </>
    );
  }

  if (door.doorType === "bifold") {
    // Folding panels are drawn as a shallow peak into the room — one per leaf set.
    const depth = (double ? w / 4 : w / 2) * 0.9 * side;
    const sets = double
      ? [
          { a: x0, peak: x0 + w / 4, b: x0 + w / 2 },
          { a: x1, peak: x1 - w / 4, b: x0 + w / 2 },
        ]
      : hingeAtEnd
        ? [{ a: x1, peak: x1 - w / 2, b: x0 }]
        : [{ a: x0, peak: x0 + w / 2, b: x1 }];

    return (
      <>
        {sets.map((set, i) => (
          <Line key={i} points={[set.a, 0, set.peak, depth, set.b, 0]} stroke={COLORS.symbol} strokeWidth={2} listening={false} />
        ))}
        <Jambs x0={x0} x1={x1} />
      </>
    );
  }

  // Sliding: overlapping panels offset to either side of the wall centreline, which is how a
  // bypass slider reads in plan. The arrow marks the panel that moves.
  const half = w / 2;
  const overlap = Math.min(6, w * 0.12);
  const front = { x: x0, width: half + overlap, y: -3.5 };
  const back = { x: x0 + half - overlap, width: half + overlap, y: 0.5 };

  return (
    <>
      <Rect x={front.x} y={front.y} width={front.width} height={3} fill={COLORS.symbol} listening={false} />
      <Rect x={back.x} y={back.y} width={back.width} height={3} fill={COLORS.symbol} listening={false} />
      <SlideArrow from={x0 + half * 0.5} to={hingeAtEnd ? x0 + 2 : x0 + half} y={-6} />
      {double && <SlideArrow from={x0 + half * 1.5} to={hingeAtEnd ? x1 - 2 : x0 + half} y={5.5} />}
      <Jambs x0={x0} x1={x1} />
    </>
  );
}

/** The little direction arrow on a sliding door's moving panel. */
function SlideArrow({ from, to, y }: { from: number; to: number; y: number }) {
  const head = to > from ? -3 : 3;
  return (
    <>
      <Line points={[from, y, to, y]} stroke={COLORS.symbol} strokeWidth={1} listening={false} />
      <Line points={[to + head, y - 2, to, y, to + head, y + 2]} stroke={COLORS.symbol} strokeWidth={1} listening={false} />
    </>
  );
}

/** A window: the wall breaks, and the opening is filled with two parallel lines. */
function WindowGlyph({ x0, x1 }: { x0: number; x1: number }) {
  return (
    <>
      <Line points={[x0, -2, x1, -2]} stroke={COLORS.symbol} strokeWidth={1.5} listening={false} />
      <Line points={[x0, 2, x1, 2]} stroke={COLORS.symbol} strokeWidth={1.5} listening={false} />
      <Jambs x0={x0} x1={x1} />
    </>
  );
}

/**
 * A cabinet: a block against the wall, extending into the room.
 *
 * Base cabinets get a solid outline and a fill; wall cabinets get a dashed outline and no fill, so
 * an upper drawn over a lower on the same run reads as two cabinets at different heights rather
 * than one covering the other. That's the standard convention, and it's the reason draw order is
 * fixed in `symbolsInDrawOrder`.
 *
 * Anchored at y=0 (the wall) by construction — there is no code path that places a cabinet away
 * from its wall.
 */
/**
 * The treads and direction arrow drawn across a stair ROOM.
 *
 * Drawn in world coordinates over the room's own outline rather than in a wall's local frame — a
 * flight is a space, not something hung on a wall. The tread lines run across the width and step
 * along the direction of travel, so rotating the flight re-lays them without moving the room.
 *
 * The count comes from `stairFlight`, so dragging the room longer draws more treads. Above roughly
 * one tread per three screen pixels they would merge into a grey block, so they drop out and the
 * arrow carries the meaning on its own.
 */
function StairsOverlay({ room, zoom }: { room: SketchRoom; zoom: number }) {
  if (!room.stairs) return null;
  const bounds = roomBounds(room);
  const { treadCount } = stairFlight(room);
  const horizontal = room.stairs.orientation === 0 || room.stairs.orientation === 180;
  const stroke = { stroke: COLORS.symbol, strokeWidth: 1.2 / zoom, listening: false as const };

  const runPx = horizontal ? bounds.width : bounds.height;
  const spacing = treadCount > 0 ? runPx / treadCount : runPx;
  const showTreads = spacing * zoom >= 3;

  // Travel runs along the flight's orientation; 180 and 270 simply reverse it.
  const forward = room.stairs.orientation === 0 || room.stairs.orientation === 90;
  const from = horizontal
    ? { x: forward ? bounds.minX : bounds.maxX, y: bounds.minY + bounds.height / 2 }
    : { x: bounds.minX + bounds.width / 2, y: forward ? bounds.minY : bounds.maxY };
  const to = horizontal
    ? { x: forward ? bounds.maxX : bounds.minX, y: from.y }
    : { x: from.x, y: forward ? bounds.maxY : bounds.minY };
  const inset = 0.12;
  const tail = { x: from.x + (to.x - from.x) * inset, y: from.y + (to.y - from.y) * inset };
  const head = { x: from.x + (to.x - from.x) * (1 - inset), y: from.y + (to.y - from.y) * (1 - inset) };
  const back = 8 / zoom;
  const ux = to.x === from.x ? 0 : Math.sign(to.x - from.x);
  const uy = to.y === from.y ? 0 : Math.sign(to.y - from.y);

  return (
    <>
      {showTreads &&
        Array.from({ length: Math.max(0, treadCount - 1) }, (_, i) => {
          const at = spacing * (i + 1);
          return horizontal ? (
            <Line key={i} points={[bounds.minX + at, bounds.minY, bounds.minX + at, bounds.maxY]} {...stroke} />
          ) : (
            <Line key={i} points={[bounds.minX, bounds.minY + at, bounds.maxX, bounds.minY + at]} {...stroke} />
          );
        })}
      <Line points={[tail.x, tail.y, head.x, head.y]} stroke={COLORS.symbol} strokeWidth={1.8 / zoom} listening={false} />
      <Line
        points={[head.x - ux * back - uy * back * 0.6, head.y - uy * back + ux * back * 0.6, head.x, head.y, head.x - ux * back + uy * back * 0.6, head.y - uy * back - ux * back * 0.6]}
        stroke={COLORS.symbol}
        strokeWidth={1.8 / zoom}
        listening={false}
      />
      <Text
        x={bounds.minX}
        y={bounds.minY + bounds.height / 2 + 6 / zoom}
        width={bounds.width}
        align="center"
        text={room.stairs.direction === "up" ? "UP" : "DN"}
        fontSize={9 / zoom}
        fill={COLORS.symbol}
        listening={false}
      />
    </>
  );
}

/**
 * Plumbing and appliances, in the wall's local frame: y=0 is the wall, +y comes into the room.
 *
 * Kept schematic rather than pictorial. A plan symbol has to read at a glance at any zoom and print
 * legibly in black and white — an estimator needs to know a toilet is there and how much floor it
 * takes, not what model it is.
 */
function FixtureGlyph({ fixture, x0, w, depth }: { fixture: FixtureSymbol; x0: number; w: number; depth: number }) {
  const cx = x0 + w / 2;
  const stroke = { stroke: COLORS.symbol, strokeWidth: 1.4, listening: false as const };
  const outline = <Rect x={x0} y={0} width={w} height={depth} fill={COLORS.fill} {...stroke} />;

  switch (fixture.fixtureType) {
    case "toilet":
      return (
        <>
          {/* tank against the wall, bowl in front */}
          <Rect x={x0 + w * 0.15} y={0} width={w * 0.7} height={depth * 0.3} fill={COLORS.fill} {...stroke} />
          <Ellipse x={cx} y={depth * 0.62} radiusX={w * 0.32} radiusY={depth * 0.3} fill={COLORS.fill} {...stroke} />
        </>
      );
    case "sink":
      return (
        <>
          {outline}
          <Ellipse x={cx} y={depth * 0.5} radiusX={w * 0.3} radiusY={depth * 0.28} {...stroke} />
        </>
      );
    case "shower":
      return fixture.showerShape === "corner" ? (
        <>
          {/* neo-angle: the front corner is cut off */}
          <Line points={[x0, 0, x0 + w, 0, x0 + w, depth * 0.45, x0 + w * 0.45, depth, x0, depth, x0, 0]} closed fill={COLORS.fill} {...stroke} />
          <Circle x={x0 + w * 0.35} y={depth * 0.4} radius={Math.min(w, depth) * 0.09} {...stroke} />
        </>
      ) : (
        <>
          {outline}
          <Line points={[x0, 0, x0 + w, depth]} {...stroke} />
          <Line points={[x0 + w, 0, x0, depth]} {...stroke} />
          <Circle x={cx} y={depth * 0.5} radius={Math.min(w, depth) * 0.09} fill={COLORS.fill} {...stroke} />
        </>
      );
    case "tub":
      return (
        <>
          <Rect x={x0} y={0} width={w} height={depth} cornerRadius={Math.min(w, depth) * 0.18} fill={COLORS.fill} {...stroke} />
          <Circle x={x0 + w * 0.15} y={depth * 0.5} radius={Math.min(w, depth) * 0.08} {...stroke} />
        </>
      );
    case "fridge":
      return (
        <>
          {outline}
          <Line points={[cx, 0, cx, depth]} {...stroke} />
        </>
      );
    case "range":
      return (
        <>
          {outline}
          {[
            [0.3, 0.32],
            [0.7, 0.32],
            [0.3, 0.7],
            [0.7, 0.7],
          ].map(([fx, fy], i) => (
            <Circle key={i} x={x0 + w * (fx as number)} y={depth * (fy as number)} radius={Math.min(w, depth) * 0.12} {...stroke} />
          ))}
        </>
      );
    case "dishwasher":
      return (
        <>
          {outline}
          <Rect x={x0 + w * 0.12} y={depth * 0.18} width={w * 0.76} height={depth * 0.64} dash={[3, 2]} {...stroke} />
        </>
      );
  }
}

function CabinetGlyph({ cabinet, x0, w, depth }: { cabinet: CabinetSymbol; x0: number; w: number; depth: number }) {
  const upper = cabinet.tier === "wall";

  return (
    <>
      <Rect
        x={x0}
        y={0}
        width={w}
        height={depth}
        fill={upper ? undefined : COLORS.cabinet}
        stroke={COLORS.symbol}
        strokeWidth={1.5}
        dash={upper ? [5, 3] : undefined}
        listening={false}
      />
      <Text
        x={x0}
        y={depth / 2 - 5}
        width={w}
        align="center"
        text={cabinet.label || (upper ? "Upper" : "Cabinet")}
        fontSize={9}
        fill={COLORS.symbol}
        listening={false}
        // The block is as wide as the run it represents; a long label in a narrow block should
        // clip rather than spill across the room.
        ellipsis
        wrap="none"
      />
    </>
  );
}

/**
 * The painted floor and ceiling.
 *
 * Drawn from run-length spans rather than cell by cell — a fully painted room is thousands of cells
 * and tens of runs, and the picture is identical. One path with many rectangles, filled once, so
 * there are no seams where translucent cells would otherwise overlap and darken at their edges.
 *
 * Both surfaces occupy the same footprint in plan, so they are told apart by treatment rather than
 * position: the floor is a solid wash, the ceiling a hatch over it. Two solid washes would mix into
 * a third colour wherever both are wet — which is common — and read as neither.
 *
 * The grid itself is never drawn. It is a way to make the area a sum instead of an integral, and a
 * PM who could see it would start trying to paint along it.
 */
function PaintedSurfaces({ room, moisture, zoom }: { room: SketchRoom; moisture: MoistureMap; zoom: number }) {
  const data = roomMoisture(moisture, room.id);
  const size = cellSizePx();

  const bounds = roomBounds(room);
  const paint = (cells: string[]) => {
    const runs = floorRuns(cells);
    return (context: Konva.Context, shape: Konva.Shape) => {
      context.beginPath();
      for (const run of runs) {
        context.rect(bounds.minX + run.col * size, bounds.minY + run.row * size, run.length * size, size);
      }
      context.closePath();
      context.fillStrokeShape(shape);
    };
  };

  return (
    <Group listening={false}>
      {data.floorCells.length > 0 && (
        <Shape listening={false} opacity={0.55} fill={COLORS.moistureFloor} sceneFunc={paint(data.floorCells)} />
      )}
      {data.ceilingCells.length > 0 && (
        <Shape
          listening={false}
          opacity={0.55}
          /* Konva accepts a canvas here at runtime; its type only names HTMLImageElement. */
          fillPatternImage={hatchPattern() as unknown as HTMLImageElement | undefined}
          fillPatternRepeat="repeat"
          sceneFunc={paint(data.ceilingCells)}
        />
      )}
    </Group>
  );
}

/**
 * A diagonal hatch, built once and reused, for the affected ceiling.
 *
 * A pattern rather than a second flat colour, so a wet ceiling over a wet floor still reads as two
 * separate facts. Cached because building a canvas per frame during a drag is exactly the kind of
 * work that makes painting feel heavy.
 */
let hatchCache: HTMLCanvasElement | null = null;
function hatchPattern(): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") return undefined;
  if (hatchCache) return hatchCache;

  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  context.strokeStyle = COLORS.moistureCeiling;
  context.lineWidth = 2;
  context.beginPath();
  // The three strokes tile seamlessly: one across the middle, two clipping the opposite corners.
  context.moveTo(0, size);
  context.lineTo(size, 0);
  context.moveTo(-1, 1);
  context.lineTo(1, -1);
  context.moveTo(size - 1, size + 1);
  context.lineTo(size + 1, size - 1);
  context.stroke();

  hatchCache = canvas;
  return canvas;
}

/**
 * Walls with a reading, coloured by how far above their dry standard they are.
 *
 * A plan has no vertical dimension, so the affected HEIGHT cannot be drawn as a height — it is
 * printed against the wall instead, while the colour carries the severity. Colouring the wall line
 * itself rather than annotating beside it is the point: the map should answer "where is the damage"
 * without anyone having to read a number.
 *
 * The mark spans only the affected RUN of the wall, and its ends are draggable. Water comes in at
 * one end of a wall, or stops at a doorway, far more often than it takes the whole length, and a
 * mark that could only be all-or-nothing would overstate every one of those — including in the air
 * mover count derived from it.
 *
 * A reading with no dry standard yet — concrete, by default — draws dashed in the neutral colour, so
 * it reads as unassessed rather than as safe.
 */
function AffectedWalls({
  room,
  moisture,
  zoom,
  interactive,
  markStyle,
  onSelectReading,
}: {
  room: SketchRoom;
  moisture: MoistureMap;
  zoom: number;
  interactive: boolean;
  markStyle: "moisture" | "scope";
  onSelectReading: (roomId: string, readingId: string | null) => void;
}) {
  const readings = roomMoisture(moisture, room.id).wallReadings;
  if (readings.length === 0) return null;
  const anchor = roomLabelAnchor(room);

  return (
    <Group>
      {readings.map((reading) => {
        const wall = wallById(room, reading.wallId);
        if (!wall) return null;
        return (
          <AffectedWall
            key={reading.id}
            reading={reading}
            wall={wall}
            anchor={anchor}
            nested={room.parentRoomId != null}
            zoom={zoom}
            interactive={interactive}
            markStyle={markStyle}
            onSelect={() => onSelectReading(room.id, reading.id)}
          />
        );
      })}
    </Group>
  );
}

/** The shortest run a mark can be shrunk to, so it can never be dragged out of existence. */
const MIN_READING_RUN = 0.04;

/**
 * The drag handles for whichever mark is selected, drawn above every room.
 *
 * Deliberately not inside the room that owns the mark. Rooms are drawn in order so a sub-room lands
 * on top of its parent, taking the parent's mark handles with it — and since a mark now stops
 * exactly where a sub-room begins, the handle at that end landed squarely under the sub-room's own
 * wall strip. The end most in need of dragging was the one end that could not be grabbed at all.
 *
 * Only one mark is ever selected, so this searches for it rather than being handed a room.
 */
function ReadingHandles({
  rooms,
  moisture,
  readingId,
  markStyle,
  zoom,
  onResize,
}: {
  rooms: SketchRoom[];
  moisture: MoistureMap;
  readingId: string;
  markStyle: "moisture" | "scope";
  zoom: number;
  onResize: (roomId: string, readingId: string, startT: number, endT: number) => void;
}) {
  let found: { room: SketchRoom; reading: WallReading } | null = null;
  for (const room of rooms) {
    const reading = roomMoisture(moisture, room.id).wallReadings.find((r) => r.id === readingId);
    if (reading) {
      found = { room, reading };
      break;
    }
  }
  if (!found) return null;

  const { room, reading } = found;
  const wall = wallById(room, reading.wallId);
  if (!wall || wall.lengthPx <= 0) return null;

  const colour = markStyle === "scope" ? COLORS.scopeMark : bandColor(readingBand(reading));
  const anchor = roomLabelAnchor(room);
  const startT = Math.max(0, Math.min(1, reading.startT));
  const endT = Math.max(startT, Math.min(1, reading.endT));

  // Same face as the mark itself, so the grips sit on the bar rather than beside it.
  const onWallA = pointOnWall(wall, startT);
  const onWallB = pointOnWall(wall, endT);
  const inset = cappedInset(
    onWallA.x,
    onWallA.y,
    onWallB.x,
    onWallB.y,
    anchor,
    (room.parentRoomId != null ? SUB_ROOM_FACE_INSET : WALL_FACE_INSET) / zoom,
  );
  const face = insetTowards(onWallA.x, onWallA.y, onWallB.x, onWallB.y, anchor, inset);
  const a = { x: face.x1, y: face.y1 };
  const b = { x: face.x2, y: face.y2 };

  /** Where a dragged handle sits along the wall, as a fraction, clamped to the wall's own extent. */
  function fractionAt(x: number, y: number): number {
    const vx = wall!.x2 - wall!.x1;
    const vy = wall!.y2 - wall!.y1;
    const lengthSquared = vx * vx + vy * vy;
    if (lengthSquared === 0) return 0;
    return Math.max(0, Math.min(1, ((x - wall!.x1) * vx + (y - wall!.y1) * vy) / lengthSquared));
  }

  /** Drag one end: clamp it, put the node back on the wall, and report the new run. */
  function moveEnd(e: KonvaEventObject<DragEvent>, isStart: boolean) {
    const raw = fractionAt(e.target.x(), e.target.y());
    // Each end moves only its own side, and never past the other.
    const t = isStart ? Math.min(raw, endT - MIN_READING_RUN) : Math.max(raw, startT + MIN_READING_RUN);
    const at = pointOnWall(wall!, Math.max(0, Math.min(1, t)));
    e.target.position(at);
    if (isStart) onResize(room.id, reading.id, t, endT);
    else onResize(room.id, reading.id, startT, t);
  }

  return (
    <Group>
      {([
        { at: a, isStart: true },
        { at: b, isStart: false },
      ] as const).map((handle) => (
        <Circle
          key={handle.isStart ? "start" : "end"}
          x={handle.at.x}
          y={handle.at.y}
          radius={HIT.handle / zoom}
          fill="#000"
          opacity={0}
          draggable
          onMouseDown={claimGesture}
          onTouchStart={claimGesture}
          /*
            Constrain the node onto the wall each frame, and never reset it to a captured point.

            The first version put the handle back to a value closed over from an earlier render.
            react-konva had already set x/y to where the drag left it, so after that reset the node
            sat somewhere react-konva did not think it was; the next render computed the same x/y it
            had last written, skipped the update as unchanged, and the invisible hit pad stayed
            behind while the visible grip moved. One drag worked and every one after it grabbed
            nothing. Snapping to the wall keeps the node exactly where the props say it is.
          */
          onDragMove={(e) => moveEnd(e, handle.isStart)}
          onDragEnd={(e) => moveEnd(e, handle.isStart)}
        />
      ))}
      {/* The visible grips, drawn beneath the finger-sized pads above. */}
      {[a, b].map((at, i) => (
        <Circle
          key={`grip-${i}`}
          x={at.x}
          y={at.y}
          radius={5 / zoom}
          fill="#fff"
          stroke={colour}
          strokeWidth={2 / zoom}
          listening={false}
        />
      ))}
    </Group>
  );
}

/**
 * How far a wall mark and its tap target sit INSIDE the room they belong to, in screen pixels.
 *
 * Two rooms drawn against each other share a wall centreline, so a mark drawn on that line belongs
 * visually to both — and a reading taken in the bathroom appeared to describe the bedroom's wall
 * too. Offsetting each room's mark into its own interior separates them: a shared wall can carry a
 * mark on each side, showing exactly what it is, which is one wall assembly with two faces.
 *
 * The tap target moves with it. That is what makes the neighbouring room reachable at all — from
 * inside the bedroom you hit the bedroom's face, from inside the bathroom you hit the bathroom's,
 * rather than always hitting whichever room happened to be drawn last.
 */
const WALL_FACE_INSET = 6;

/**
 * How far a SUB-ROOM's mark sits inside itself instead.
 *
 * The two-faces rule above assumes the rooms sharing a wall are on opposite sides of it. A closet
 * nested in a bedroom is not: both interiors are on the same side, so both marks inset the same
 * way by the same amount and land on the same line — two records that read as one continuous bar.
 * Pushing the nested one deeper into its own footprint puts them on separate lines, so a marked
 * closet is visibly a marked closet rather than more of the room around it.
 *
 * The TAP target deliberately keeps the shallow inset. The strips of the two rooms coincide there,
 * and the sub-room is drawn last so it wins its own stretch — which is what makes a closet wall
 * tappable at all. Moving its strip deeper would hand the near edge back to the parent.
 */
const SUB_ROOM_FACE_INSET = 15;

/** Shift a segment perpendicular, towards the given interior point. */
function insetTowards(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  towards: { x: number; y: number },
  distance: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x1, y1, x2, y2 };

  // Perpendicular, then flipped to whichever side the interior point is on.
  let nx = -dy / length;
  let ny = dx / length;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  if ((towards.x - midX) * nx + (towards.y - midY) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  return { x1: x1 + nx * distance, y1: y1 + ny * distance, x2: x2 + nx * distance, y2: y2 + ny * distance };
}

function AffectedWall({
  reading,
  wall,
  anchor,
  nested,
  zoom,
  interactive,
  markStyle,
  onSelect,
}: {
  reading: WallReading;
  wall: WallGeometry;
  anchor: { x: number; y: number };
  /** This room sits inside another, so its mark goes deeper — see `SUB_ROOM_FACE_INSET`. */
  nested: boolean;
  zoom: number;
  interactive: boolean;
  markStyle: "moisture" | "scope";
  onSelect: () => void;
}) {
  const scope = markStyle === "scope";
  const band = scope ? null : readingBand(reading);
  // A scope mark is one thing marked out, not a measurement — one colour, and no reading label.
  const colour = scope ? COLORS.scopeMark : bandColor(band);

  const startT = Math.max(0, Math.min(1, reading.startT));
  const endT = Math.max(startT, Math.min(1, reading.endT));
  const onWallA = pointOnWall(wall, startT);
  const onWallB = pointOnWall(wall, endT);

  // Drawn on this room's face of the wall, not on the shared centreline — see `WALL_FACE_INSET`.
  const inset = cappedInset(
    onWallA.x,
    onWallA.y,
    onWallB.x,
    onWallB.y,
    anchor,
    (nested ? SUB_ROOM_FACE_INSET : WALL_FACE_INSET) / zoom,
  );
  const face = insetTowards(onWallA.x, onWallA.y, onWallB.x, onWallB.y, anchor, inset);
  const a = { x: face.x1, y: face.y1 };
  const b = { x: face.x2, y: face.y2 };

  // The label follows the marked run's own midpoint, not the wall's, so a mark on one end of a long
  // wall is annotated where it actually is.
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = anchor.x - midX;
  const dy = anchor.y - midY;
  const len = Math.hypot(dx, dy) || 1;
  const labelInset = 27 / zoom;
  const labelX = midX + (dx / len) * labelInset;
  const labelY = midY + (dy / len) * labelInset;

  return (
    <Group>
      <Line
        points={[a.x, a.y, b.x, b.y]}
        stroke={colour}
        strokeWidth={7 / zoom}
        lineCap="butt"
        dash={!scope && band === null ? [6 / zoom, 4 / zoom] : undefined}
        opacity={0.85}
        listening={false}
      />

      {/* Its own tap target, so a mark can be selected without going through the wall beneath it. */}
      {interactive && (
        <Line
          points={[a.x, a.y, b.x, b.y]}
          stroke="#000"
          strokeWidth={HIT.handle / zoom}
          opacity={0}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onSelect();
          }}
          onTouchStart={(e) => {
            e.cancelBubble = true;
            onSelect();
          }}
        />
      )}

      {/* A plate behind the text: over the floor wash, coloured type alone is not readable. */}
      <Group listening={false} visible={!scope}>
        <Rect
          x={labelX - 20 / zoom}
          y={labelY - 7 / zoom}
          width={40 / zoom}
          height={14 / zoom}
          cornerRadius={3 / zoom}
          fill="#fff"
          opacity={0.82}
        />
        <Text
          x={labelX - 20 / zoom}
          y={labelY - 5 / zoom}
          width={40 / zoom}
          align="center"
          text={formatFeetInches(reading.affectedHeightFeet)}
          fontSize={10 / zoom}
          fontStyle="bold"
          fill={colour}
        />
      </Group>

    </Group>
  );
}
