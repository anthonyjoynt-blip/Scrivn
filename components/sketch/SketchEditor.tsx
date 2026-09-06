"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  type FreeCabinet,
  type Sketch,
  type SketchRoom,
  type SketchSymbol,
  type SketchView,
  type SymbolType,
  SYMBOL_LABEL,
  clampZoom,
  defaultView,
  type CeilingType,
  type FixtureType,
  CEILING_TYPE_LABEL,
  FIXTURE_LABEL,
  DEFAULT_CEILING_HEIGHT_FEET,
  MIN_WALL_PX,
  PIXELS_PER_FOOT,
  DEFAULT_ROOM_FEET,
  dragWall,
  ensureClockwise,
  exposedRunAt,
  formatFeetInches,
  formatSmallDimension,
  insertVertexOnWall,
  moveFreeCabinet,
  moveSymbolAlongWall,
  moveVertex,
  newFreeCabinet,
  newSketchId,
  newSymbol,
  parseFeetInches,
  pruneCollinearVertices,
  newStairRoom,
  rectangleVertices,
  removeVertex,
  rotateStairs,
  stairCeiling,
  stairFlight,
  roomBounds,
  containingRoomId,
  snapRoomTranslation,
  snapWallToNeighbours,
  translateRoom as translate,
  withDerivedParents,
  sketchSummaryText,
  translateRoom,
  wallById,
  wallsOf,
  withFixtureType,
  withFreeCabinetSizePx,
  withSymbolWidthPx,
  withWallLength,
  MAIN_LEVEL,
  defaultUnderlayLevel,
  levelLabel,
  levelsOf,
  roomsOnLevel,
  withLevel,
} from "@/lib/sketch";
import { FreeCabinetPanel, SymbolPanel } from "./SymbolPanel";
import { QuantitiesPanel } from "./QuantitiesPanel";
import { type QuantityOptions, DEFAULT_QUANTITY_OPTIONS } from "@/lib/sketchQuantities";
import type { MoistureTool, ToolMode } from "./SketchCanvas";
import {
  type MoistureMap,
  type PaintSurface,
  type RoomMoisture,
  startingDryStandard,
  setReferenceReading,
  emptyRoomMoisture,
  pruneMoisture,
  roomIdForReading,
  roomMoisture,
  setRoomMoisture,
} from "@/lib/moisture";
import { MoistureLegend, MoisturePanel } from "./MoisturePanel";
import { EquipmentPanel } from "./EquipmentPanel";
import { DEFAULT_EQUIPMENT_SETTINGS, type EquipmentSettings } from "@/lib/equipment";

/**
 * The sketch tool's UI: canvas plus everything around it.
 *
 * Konva reads `window` when it loads, so the canvas is pulled in with ssr:false. Without that the
 * whole /claim route fails to render on the server — the error surfaces as a build-time module
 * resolution failure for `canvas`, which reads as a dependency problem and isn't one.
 */
const SketchCanvas = dynamic(() => import("./SketchCanvas"), {
  ssr: false,
  loading: () => <div className="sketch-canvas-loading">Loading sketch…</div>,
});

const CANVAS_HEIGHT = 460;

/**
 * A new room is a real 12' x 12' at the default scale, not an arbitrary rectangle of pixels.
 *
 * Rooms used to arrive unscaled, so every wall read "tap to set" and anything placed before a
 * measurement was entered had no real size. Starting at a plausible square means the sketch measures
 * something from the first frame even if the user goes straight to dragging walls around.
 */
const NEW_ROOM = {
  width: DEFAULT_ROOM_FEET * PIXELS_PER_FOOT,
  height: DEFAULT_ROOM_FEET * PIXELS_PER_FOOT,
  gap: 30,
};

/**
 * Where a new room lands: clear of every room already placed.
 *
 * The previous version offset each new room by a fixed 26px, so every room after the first landed
 * on top of the one before it — overlapping outlines, overlapping labels, and no way to tell which
 * wall belonged to which room. Rooms are independent of each other, so they should start apart.
 *
 * Laid out left to right, wrapping to a new row when the canvas runs out of width, and skipping any
 * slot already occupied — position has to be checked rather than derived from a count, because
 * rooms get moved and reshaped after they're placed. Falls back to a diagonal offset if the area is
 * full; by then the user is panning anyway, and a room they can drag apart beats no room at all.
 */
function nextRoomPosition(rooms: SketchRoom[], canvasWidth: number): { x: number; y: number } {
  const { width, height, gap } = NEW_ROOM;
  const taken = rooms.map(roomBounds);
  const overlaps = (x: number, y: number) =>
    taken.some((b) => x < b.maxX + gap && x + width + gap > b.minX && y < b.maxY + gap && y + height + gap > b.minY);

  for (let y = 40; y + height <= CANVAS_HEIGHT * 2; y += height + gap) {
    for (let x = 40; x + width <= Math.max(canvasWidth, width + 80); x += width + gap) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 40 + rooms.length * 24, y: 40 + rooms.length * 24 };
}

interface PendingLength {
  roomId: string;
  wallId: string;
  /** Viewport coordinates of the tap, so the input can appear next to the wall rather than in a modal. */
  screen: { x: number; y: number };
}

export function SketchEditor({
  sketch,
  knownRoomNames,
  moisture,
  statedEquipment,
  onResolveEquipment,
  onChange,
  onMoistureChange,
  onClose,
  startReadOnly = false,
}: {
  sketch: Sketch;
  /** Room names already used elsewhere in this claim — offered as autocomplete so a sketch room can be matched back to the scope later. */
  knownRoomNames: string[];
  /** The moisture layer. Separate from `sketch` on purpose — see `lib/moisture.ts`. */
  moisture: MoistureMap;
  /** Equipment the claim already states, so a finished map can be checked against it on the spot. */
  statedEquipment?: Record<string, Partial<Record<string, number>>>;
  onResolveEquipment?: (roomName: string, equipmentType: string, adopt: number | null) => void;
  /**
   * Accepts an updater as well as a value, for the same reason `onMoistureChange` does.
   *
   * It was a plain setter, and `updateRoom` read the current sketch from props to build the next
   * one — so two changes in the same frame both started from the pre-render state and the second
   * silently replaced the first. Two quick presses of the arrow key turned a flight once, not
   * twice. Passing an updater is what makes each change start from the one before it.
   */
  onChange: Dispatch<SetStateAction<Sketch>>;
  /**
   * Takes an updater, not a value, because painting fires many times per stroke: reading the map
   * from props each time would let two brush dabs in the same frame overwrite one another.
   */
  onMoistureChange: Dispatch<SetStateAction<MoistureMap>>;
  onClose: () => void;
  /**
   * Open looking rather than drawing.
   *
   * A finished sketch is looked at far more often than it is changed — checking a wall length while
   * answering a question, showing somebody the layout — and every one of those visits used to be an
   * edit session, where a stray drag on a phone moves a room and nothing says it happened. The
   * geometry is the basis of quantities the scope is built from, so a silent nudge is a silent
   * change to a number on a document.
   */
  startReadOnly?: boolean;
}) {
  const [tool, setTool] = useState<ToolMode>("select");
  /*
    Read-only is enforced by blocking pointer events on the CANVAS, not by disabling each tool.

    Disabling tools one at a time means every tool added later has to remember to check a flag, and
    the one that forgets fails silently — a drag that edits a plan nobody meant to edit. Blocking at
    the surface cannot be forgotten: nothing reaches the canvas at all. Zoom, pan and level switching
    are buttons outside it, so looking around still works.
  */
  const [readOnly, setReadOnly] = useState(startReadOnly);
  /**
   * Sketching or mapping. A mode rather than another tool in the row: it changes what a tap means
   * everywhere, what the panel below shows, and whether the geometry can be edited at all.
   */
  const [mode, setMode] = useState<"sketch" | "moisture">("sketch");
  const [moistureTool, setMoistureTool] = useState<MoistureTool>("read");
  /** Floor or ceiling — the brush paints one surface at a time, into separate sets of cells. */
  const [paintSurface, setPaintSurface] = useState<PaintSurface>("floor");
  /** The wall mark whose ends can be dragged. Only one at a time, or a wall fills with handles. */
  const [selectedReadingId, setSelectedReadingId] = useState<string | null>(null);
  const [equipmentSettings, setEquipmentSettings] = useState<EquipmentSettings>(DEFAULT_EQUIPMENT_SETTINGS);
  /** The clean sketch, on demand — the same geometry with the layer simply not drawn. */
  const [showMoisture, setShowMoisture] = useState(true);
  /** The reading a wall tap just created, so its row can be pointed out in the panel. */
  const [newReadingId, setNewReadingId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [pendingLength, setPendingLength] = useState<PendingLength | null>(null);
  /** Set when a room name on the canvas is double-tapped, to float a rename box over it. */
  const [pendingName, setPendingName] = useState<{ roomId: string; screen: { x: number; y: number } } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [lengthDraft, setLengthDraft] = useState("");
  const [lengthError, setLengthError] = useState<string | null>(null);
  /**
   * The camera. Held here rather than in the sketch data because it's a viewport, not a
   * measurement — see `SketchView` in lib/sketch.ts for why it's shaped this way.
   */
  const [view, setView] = useState<SketchView>(defaultView);
  /** Whether each symbol prints its own size on the plan. On by default; off when it gets busy. */
  const [showSizes, setShowSizes] = useState(true);
  /**
   * Which deductions the quantities apply. Editor state rather than sketch data: they change how the
   * sketch is REPORTED, not what was drawn, and two people reading the same sketch may legitimately
   * want different answers.
   */
  const [quantityOptions, setQuantityOptions] = useState<QuantityOptions>(DEFAULT_QUANTITY_OPTIONS);
  /**
   * Which fixture the Fixture tool will drop.
   *
   * Chosen BEFORE placing, from the toolbar. It was previously only changeable on the properties
   * panel after the fact, which meant every fixture arrived as a toilet and the other six were
   * effectively hidden below the canvas.
   */
  const [pendingFixture, setPendingFixture] = useState<FixtureType>("toilet");
  /**
   * Full screen: the sketch takes the whole viewport, with the properties beside the canvas.
   *
   * The complaint this answers was about reach, not size. Turning a door's swing or a flight's
   * direction meant scrolling until the drawing you were changing had left the screen, then
   * scrolling back to see what happened — on a phone, most of the way down the page. Filling the
   * viewport puts the canvas and the controls in view at once, which is also the only arrangement in
   * which a change and its result are visible in the same glance.
   */
  const [expanded, setExpanded] = useState(false);
  /**
   * Which storey is being drawn, and which other one is traced underneath it.
   *
   * Editor state rather than sketch data: a level is a fact about the building and belongs on the
   * rooms (see `SketchRoom.level`), but WHICH ONE you happen to be looking at is a view, in exactly
   * the way `view` is. Two people opening the same claim should not inherit each other's tab.
   */
  const [activeLevel, setActiveLevel] = useState(MAIN_LEVEL);
  /** Null hides the underlay; otherwise the level being traced. Seeded on first use, see below. */
  const [underlayLevel, setUnderlayLevel] = useState<number | null>(null);
  const [underlayTouched, setUnderlayTouched] = useState(false);

  const levels = useMemo(() => levelsOf(sketch), [sketch]);
  const activeRooms = useMemo(() => roomsOnLevel(sketch, activeLevel), [sketch, activeLevel]);
  /*
    Defaults to the level below where one exists, and stops choosing for the PM the moment they
    choose for themselves — a toggle that keeps reasserting itself is worse than one that starts
    wrong once.
  */
  const resolvedUnderlay = underlayTouched ? underlayLevel : defaultUnderlayLevel(sketch, activeLevel);
  const underlayRooms = useMemo(
    () => (resolvedUnderlay === null ? [] : roomsOnLevel(sketch, resolvedUnderlay)),
    [sketch, resolvedUnderlay],
  );
  /**
   * The last room deleted, held so it can be put back — a one-step undo for the one destructive
   * action in the tool. Cleared when it is restored, and replaced when another room is deleted;
   * there is no stack, because a stack implies a history the rest of the editor does not keep.
   */
  const [deletedRoom, setDeletedRoom] = useState<{ room: SketchRoom; index: number; moisture: RoomMoisture } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);
  /**
   * Stage height. Fixed in the page, measured when expanded.
   *
   * Measuring is safe only in the expanded layout, where CSS gives the wrapper its height (`flex: 1`
   * inside a viewport-height column) and content has no say in it. In the page the wrapper is sized
   * BY the stage, so measuring it there would be a loop: the stage would grow to the wrapper, the
   * wrapper to the stage, forever.
   */
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT);

  // The stage needs explicit pixel dimensions — it can't be sized in CSS — so the container is
  // measured and the stage follows it. ResizeObserver rather than a window listener so this also
  // reacts to the surrounding layout changing, not only to the viewport.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setCanvasWidth(Math.max(280, el.clientWidth));
      setCanvasHeight(expanded ? Math.max(240, el.clientHeight) : CANVAS_HEIGHT);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  /*
    While expanded the sketch owns the viewport, so the page behind it must not scroll — on iOS a
    touch that starts on the canvas and drifts otherwise drags the page underneath it.
  */
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  /**
   * Deselecting a room drops any break that was added and never used.
   *
   * A fresh break sits exactly on the wall it split, so the outline looks unchanged while the wall's
   * measurement has quietly become two. Pruning collinear corners on the way out means an unused
   * break disappears when you click away; one that was actually pulled is no longer collinear and
   * survives. Runs as an effect on the id, so it fires for the room being LEFT, not the one arriving.
   */
  const previousSelection = useRef<string | null>(null);
  useEffect(() => {
    const leaving = previousSelection.current;
    previousSelection.current = selectedRoomId;
    if (!leaving || leaving === selectedRoomId) return;
    onChange({ ...sketch, rooms: sketch.rooms.map((room) => (room.id === leaving ? pruneCollinearVertices(room) : room)) });
    // `sketch`/`onChange` are intentionally omitted: this must run when the selection changes, not
    // every time the sketch does, or it would prune mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId]);

  const selectedRoom = sketch.rooms.find((r) => r.id === selectedRoomId) ?? null;

  /** Readings for a room that has been deleted would otherwise linger in the output. */
  useEffect(() => {
    onMoistureChange((prev) => {
      const next = pruneMoisture(prev, sketch);
      return Object.keys(next.rooms).length === Object.keys(prev.rooms).length ? prev : next;
    });
  }, [sketch, onMoistureChange]);

  function updateRoomMoisture(roomId: string, update: (prev: RoomMoisture) => RoomMoisture) {
    onMoistureChange((prev) => setRoomMoisture(prev, roomId, update(roomMoisture(prev, roomId))));
  }

  /**
   * Drops one wall mark, from whichever room actually owns it.
   *
   * The owner is looked up rather than passed in. It used to take the selected room's id, which is
   * right only while the selection and the mark agree — and tapping a mark on a room you had not
   * selected made them disagree, so the filter ran over the wrong room's list and removed nothing.
   */
  function removeReading(readingId: string) {
    const roomId = roomIdForReading(moisture, readingId);
    if (!roomId) return;
    updateRoomMoisture(roomId, (prev) => ({ ...prev, wallReadings: prev.wallReadings.filter((r) => r.id !== readingId) }));
    setSelectedReadingId((current) => (current === readingId ? null : current));
    setNewReadingId((current) => (current === readingId ? null : current));
  }

  /**
   * A wall was tapped while mapping: that wall gets a reading.
   *
   * One per wall. Tapping a wall that already has one selects it rather than stacking a second,
   * since two readings on one wall have no way to be told apart on the plan.
   */
  const handleTapWallForReading = useCallback(
    (roomId: string, wallId: string, t: number) => {
      /*
        Everything that touches OTHER state happens out here, never inside the updater below.

        A state updater is not run when it is handed over — React calls it later, while rendering the
        component that owns that state. Setting this component's state from in there is therefore a
        setState during another component's render, which React rightly complains about. The updater
        form is still worth having for the map itself (painting fires many times per stroke), but a
        tap is a single event, so the decision can be made from props before anything is queued.
      */
      const data = roomMoisture(moisture, roomId);
      const existing = data.wallReadings.find((r) => r.wallId === wallId);
      setSelectedRoomId(roomId);

      if (existing) {
        setNewReadingId(existing.id);
        setSelectedReadingId(existing.id);
        return;
      }

      const room = sketch.rooms.find((r) => r.id === roomId);
      const run: [number, number] = room ? exposedRunAt(room, wallId, sketch.rooms, t) : [0, 1];

      const id = newSketchId("reading");
      setNewReadingId(id);
      setSelectedReadingId(id);
      onMoistureChange((prev) => {
        const current = roomMoisture(prev, roomId);
        // Idempotent: a doubled event must not leave two readings on one wall, which the plan has no
        // way to tell apart.
        if (current.wallReadings.some((r) => r.wallId === wallId)) return prev;
        return setRoomMoisture(prev, roomId, {
          ...current,
          wallReadings: [
            ...current.wallReadings,
            {
              id,
              wallId,
              /*
                The stretch of wall that was tapped, not the whole wall.

                A closet inside the room owns part of its parent's wall — see `exposedWallRuns` —
                and claiming that stretch from the parent left the closet's own mark with nowhere to
                go. Where nothing is nested this is still [0, 1], the whole wall, and the PM drags
                the ends in to the run that is actually wet either way.
              */
              startT: run[0],
              endT: run[1],
              affectedHeightFeet: 2,
              material: "drywall",
              // Unmeasured, which shows as significantly elevated — see `readingBand`. Nobody marks
              // a dry wall, so that is the default worth saving a step on.
              reading: null,
              // The job's reference reading if one has been taken, and only then the published range.
              dryStandard: startingDryStandard(moisture, "drywall"),
            },
          ],
        });
      });
    },
    // `sketch` too: the run a new mark covers is read off the geometry, sub-rooms included.
    [moisture, sketch, onMoistureChange],
  );

  /** The brush crossed these cells. A Set does the union or difference; order never matters. */
  const handlePaintFloor = useCallback(
    (roomId: string, cells: string[], erase: boolean, surface: PaintSurface) => {
      if (cells.length === 0) return;
      onMoistureChange((prev) => {
        const data = roomMoisture(prev, roomId);
        const key = surface === "ceiling" ? "ceilingCells" : "floorCells";
        const current = data[key];
        const next = new Set(current);
        for (const cell of cells) {
          if (erase) next.delete(cell);
          else next.add(cell);
        }
        if (next.size === current.length) return prev;
        return setRoomMoisture(prev, roomId, { ...data, [key]: [...next] });
      });
    },
    [onMoistureChange],
  );

  /** A wall mark's run changed. Clamped in the canvas; stored verbatim. */
  const handleResizeReading = useCallback(
    (roomId: string, readingId: string, startT: number, endT: number) => {
      onMoistureChange((prev) => {
        const data = roomMoisture(prev, roomId);
        return setRoomMoisture(prev, roomId, {
          ...data,
          wallReadings: data.wallReadings.map((r) => (r.id === readingId ? { ...r, startT, endT } : r)),
        });
      });
    },
    [onMoistureChange],
  );
  const selectedSymbol = selectedRoom?.symbols.find((s) => s.id === selectedSymbolId) ?? null;
  // Islands share `selectedSymbolId` — ids are unique across both collections, and only one thing
  // is ever selected, so a second piece of selection state would only be able to disagree.
  const selectedIsland = selectedRoom?.freeCabinets.find((c) => c.id === selectedSymbolId) ?? null;

  /**
   * The room this one is drawn inside, ignoring whether the user has opted out of nesting.
   *
   * Asked with the opt-out cleared on purpose: the control has to stay on screen after you press
   * "Separate room", or the only way back would be to drag the room out and in again.
   */
  const nestedInside = (() => {
    if (!selectedRoom) return null;
    const asIfNesting = sketch.rooms.map((r) => (r.id === selectedRoom.id ? { ...r, nestingOptOut: false } : r));
    const parentId = containingRoomId(asIfNesting, selectedRoom.id);
    return parentId ? (sketch.rooms.find((r) => r.id === parentId) ?? null) : null;
  })();

  function setNesting(roomId: string, optOut: boolean) {
    onChange({ ...sketch, rooms: withDerivedParents(sketch.rooms.map((r) => (r.id === roomId ? { ...r, nestingOptOut: optOut } : r))) });
  }

  const updateRoom = useCallback(
    (roomId: string, update: (room: SketchRoom) => SketchRoom) => {
      // Functional, so two changes in one frame compose instead of the second replacing the first.
      onChange((prev) => ({ ...prev, rooms: prev.rooms.map((room) => (room.id === roomId ? update(room) : room)) }));
    },
    [onChange],
  );

  const updateSymbol = useCallback(
    (roomId: string, symbolId: string, update: (symbol: SketchSymbol, room: SketchRoom) => SketchSymbol) => {
      updateRoom(roomId, (room) => ({ ...room, symbols: room.symbols.map((s) => (s.id === symbolId ? update(s, room) : s)) }));
    },
    [updateRoom],
  );

  const updateIsland = useCallback(
    (roomId: string, islandId: string, update: (cabinet: FreeCabinet, room: SketchRoom) => FreeCabinet) => {
      updateRoom(roomId, (room) => ({ ...room, freeCabinets: room.freeCabinets.map((c) => (c.id === islandId ? update(c, room) : c)) }));
    },
    [updateRoom],
  );

  function handlePlaceIsland(roomId: string, x: number, y: number) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const island = newFreeCabinet(room, x, y);
    updateRoom(roomId, (r) => ({ ...r, freeCabinets: [...r.freeCabinets, island] }));
    setSelectedRoomId(roomId);
    setSelectedSymbolId(island.id);
    setTool("select");
  }

  /**
   * Desktop keyboard shortcuts.
   *
   *   Delete / Backspace   the selected symbol, island, or — with nothing inside it selected — the room
   *   ← →                  mirror a door horizontally; turn a flight a quarter turn each way
   *   ↑ ↓                  mirror a door vertically; point a flight up or down
   *   Escape               leave full screen
   *
   * Anything typed into a field is left alone — without the editable-target guard, backspacing a
   * typo out of the room-name box would delete the symbol you had selected.
   *
   * Deleting a ROOM used to be refused here on the grounds that a room holds a lot of work and there
   * was no undo. The refusal was the wrong half of that to keep: what it actually produced was a key
   * that worked on everything except the one thing people reached for it with. Deleting a room now
   * stashes it — see `restoreRoom` — so the reason not to has been removed rather than worked around.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      if (event.key === "Escape" && expanded) {
        setExpanded(false);
        event.preventDefault();
        return;
      }

      // Ctrl/Cmd+Z brings back the last deleted room. Deliberately NOT general undo: this is the one
      // action with no other way back, and pretending to more history than exists would be worse.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (deletedRoom) {
          restoreRoom();
          event.preventDefault();
        }
        return;
      }

      /*
        While mapping, Delete removes the selected wall mark.

        Mapping freezes the geometry, so the key has nothing else it could mean here — and a mark is
        the one thing in this mode that gets put down by a single tap and therefore gets put down by
        accident. Removing it meant finding its card in the panel and pressing Remove there, which is
        a long way from the wall you just mistapped.
      */
      if (mode === "moisture") {
        if ((event.key === "Delete" || event.key === "Backspace") && selectedReadingId) {
          removeReading(selectedReadingId);
          event.preventDefault();
        }
        return;
      }

      // Everything below edits the geometry, which mapping deliberately freezes. Escape and undo,
      // above, are about the tool rather than the drawing, so they work in either mode.
      if (!selectedRoom) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedSymbol) {
          updateRoom(selectedRoom.id, (room) => ({ ...room, symbols: room.symbols.filter((s) => s.id !== selectedSymbol.id) }));
          setSelectedSymbolId(null);
        } else if (selectedIsland) {
          updateRoom(selectedRoom.id, (room) => ({ ...room, freeCabinets: room.freeCabinets.filter((c) => c.id !== selectedIsland.id) }));
          setSelectedSymbolId(null);
        } else {
          handleDeleteRoom(selectedRoom.id);
        }
        event.preventDefault();
        return;
      }

      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!horizontal && !vertical) return;

      /*
        A flight, when nothing inside the room is selected. The arrow means what it points at: left
        and right turn it that way round, up and down are which way it climbs — the two things about
        a flight the drawing cannot show on its own.
      */
      if (selectedRoom.stairs && !selectedSymbol && !selectedIsland) {
        event.preventDefault();
        if (horizontal) {
          updateRoom(selectedRoom.id, (room) => rotateStairs(room, event.key === "ArrowRight" ? 1 : -1));
        } else {
          const direction = event.key === "ArrowUp" ? "up" : "down";
          updateRoom(selectedRoom.id, (room) => (room.stairs ? { ...room, stairs: { ...room.stairs, direction } } : room));
        }
        return;
      }

      if (selectedSymbol?.type !== "door") return;

      // Stop the arrow keys scrolling the page out from under the sketch.
      event.preventDefault();
      updateSymbol(selectedRoom.id, selectedSymbol.id, (symbol) =>
        symbol.type !== "door" ? symbol : horizontal ? { ...symbol, flipX: !symbol.flipX } : { ...symbol, flipY: !symbol.flipY },
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // No dependency array on purpose. The handler closes over most of this component's state plus
    // two functions redeclared each render, so an exhaustive list would re-subscribe every render
    // anyway — and a partial one would leave the listener holding a stale selection.
  });

  /**
   * Commits a room drag: snap to the neighbours, move, then re-derive who is inside whom.
   *
   * Parents are recomputed for EVERY room rather than just the one that moved, because moving a
   * large room can swallow or release a small one that never moved itself.
   */
  function handleMoveRoom(roomId: string, dx: number, dy: number) {
    // Snapping is applied on every frame of the drag rather than only at the end, so the room
    // visibly latches onto its neighbours while it is being moved instead of jumping on release.
    const snapped = snapRoomTranslation(sketch.rooms, roomId, dx, dy);
    const moved = sketch.rooms.map((room) => (room.id === roomId ? translate(room, snapped.dx, snapped.dy) : room));
    onChange({ ...sketch, rooms: withDerivedParents(moved) });
  }

  function handleAddRoom() {
    const { x, y } = nextRoomPosition(activeRooms, canvasWidth);
    // A rectangle is just the four-vertex case; every new room starts as one.
    const room: SketchRoom = {
      id: newSketchId("room"),
      name: "",
      vertices: ensureClockwise(rectangleVertices(x, y, NEW_ROOM.width, NEW_ROOM.height)),
      ceilingHeightFeet: DEFAULT_CEILING_HEIGHT_FEET,
      ceilingType: "flat",
      ceilingPeakFeet: null,
      stairs: null,
      parentRoomId: null,
      nestingOptOut: false,
      symbols: [],
      freeCabinets: [],
      // A new room joins the storey being drawn, not the main one.
      level: activeLevel,
    };
    onChange({ ...sketch, rooms: [...sketch.rooms, room] });
    setSelectedRoomId(room.id);
    setSelectedSymbolId(null);
    setTool("select");
  }

  /**
   * Adds an empty storey and moves to it.
   *
   * Empty is the point: a level is added because there is something up there to draw, and the PM is
   * about to draw it. Switching straight to it saves the tap and makes clear the add worked, since
   * an empty level looks exactly like the one you were on until you notice the tab changed.
   */
  function handleAddLevel(direction: 1 | -1) {
    const existing = levelsOf(sketch);
    const next = direction > 0 ? Math.max(...existing) + 1 : Math.min(...existing) - 1;
    // Recorded on the sketch, not merely switched to: a level with nothing drawn on it yet has no
    // rooms to infer its existence from, so without this the tab vanishes the moment it is made.
    onChange((prev) => withLevel(prev, next));
    setActiveLevel(next);
    setSelectedRoomId(null);
    setSelectedSymbolId(null);
    /*
      Re-seed the underlay for the level just arrived at. Without this, a PM who had turned the
      underlay off on one level would arrive at a brand-new empty one with nothing to trace over,
      which is the exact moment the underlay is most useful.
    */
    setUnderlayTouched(false);
  }

  function handleSwitchLevel(level: number) {
    setActiveLevel(level);
    setSelectedRoomId(null);
    setSelectedSymbolId(null);
    setUnderlayTouched(false);
  }

  function handleAddStairs() {
    const { x, y } = nextRoomPosition(activeRooms, canvasWidth);
    // Stairs are a room (see `StairsData`), so they join the storey being drawn like any other.
    const room = { ...newStairRoom(x, y), level: activeLevel };
    onChange({ ...sketch, rooms: withDerivedParents([...sketch.rooms, room]) });
    setSelectedRoomId(room.id);
    setSelectedSymbolId(null);
    setTool("select");
  }

  /**
   * Deletes a room, keeping it and its readings aside so the delete can be taken back.
   *
   * The moisture has to be captured HERE, before the room goes: `pruneMoisture` runs as an effect on
   * the sketch and drops the readings of any room that no longer exists, so by the time anything
   * else looked they would be gone. Position in the list is kept too — a room restored to the end
   * would come back visibly rearranged, which reads as a second mistake rather than an undo.
   */
  function handleDeleteRoom(roomId: string) {
    const index = sketch.rooms.findIndex((room) => room.id === roomId);
    const room = sketch.rooms[index];
    if (!room) return;

    setDeletedRoom({ room, index, moisture: roomMoisture(moisture, roomId) });
    onChange((prev) => ({ ...prev, rooms: prev.rooms.filter((r) => r.id !== roomId) }));
    if (selectedRoomId === roomId) {
      setSelectedRoomId(null);
      setSelectedSymbolId(null);
    }
  }

  /** Puts the last deleted room back where it was, readings and all. */
  function restoreRoom() {
    if (!deletedRoom) return;
    onChange((prev) => {
      const rooms = [...prev.rooms];
      rooms.splice(Math.min(deletedRoom.index, rooms.length), 0, deletedRoom.room);
      return { ...prev, rooms: withDerivedParents(rooms) };
    });
    updateRoomMoisture(deletedRoom.room.id, () => deletedRoom.moisture);
    setSelectedRoomId(deletedRoom.room.id);
    setDeletedRoom(null);
  }

  function handleTapWall(roomId: string, wallId: string, screen: { x: number; y: number }) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    const existing = room ? (wallById(room, wallId)?.lengthFeet ?? null) : null;
    // Pre-fill with the current length so correcting a typo doesn't mean retyping from scratch.
    setLengthDraft(existing == null ? "" : formatFeetInches(existing));
    setLengthError(null);
    setPendingLength({ roomId, wallId, screen });
  }

  /**
   * Commits a typed wall length, which now RESIZES the room — see `withWallLength`.
   *
   * The resize is checked rather than assumed. `withWallLength` refuses anything that would collapse
   * the polygon or fall below the minimum wall, and it refuses by returning the room untouched; if
   * that were taken as success the prompt would close on a length that never happened, which reads
   * as the app ignoring you. So the wall is re-measured afterwards and the prompt stays open with a
   * reason when it didn't take.
   *
   * Nesting is re-derived because a resize changes what contains what: a closet grown past its
   * bedroom is no longer inside it, and a room stretched over a neighbour now is.
   */
  function handleSubmitLength() {
    if (!pendingLength) return;
    const feet = parseFeetInches(lengthDraft);
    if (feet == null || feet <= 0) {
      setLengthError('Enter a length like 12\'6" or 12.5');
      return;
    }

    const room = sketch.rooms.find((r) => r.id === pendingLength.roomId);
    if (!room) return;
    const resized = withWallLength(room, pendingLength.wallId, feet);
    const got = wallById(resized, pendingLength.wallId)?.lengthFeet;
    // Half an inch of tolerance: the reshape is exact, but the round trip through pixels is not.
    if (got == null || Math.abs(got - feet) > 1 / 24) {
      setLengthError(`That would leave the room too small to draw. Shortest wall is ${formatFeetInches(MIN_WALL_PX / PIXELS_PER_FOOT)}.`);
      return;
    }

    onChange((prev) => ({
      ...prev,
      rooms: withDerivedParents(prev.rooms.map((r) => (r.id === resized.id ? resized : r))),
    }));
    setPendingLength(null);
    setLengthDraft("");
  }

  function handlePlaceSymbol(roomId: string, wallId: string, t: number) {
    // Islands are placed on open floor, and a break isn't a symbol at all — both are handled
    // elsewhere and must not fall through to symbol placement.
    if (tool === "select" || tool === "island" || tool === "break") return;
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    // An opening is a door without a leaf — see `ToolMode`.
    const created = newSymbol(tool === "opening" ? "door" : (tool as SymbolType), wallId, t, room);
    // A fixture is created generic then specialised, so it arrives at its own standard footprint
    // rather than a toilet's.
    const symbol =
      created.type === "fixture"
        ? withFixtureType(created, room, pendingFixture)
        : tool === "opening" && created.type === "door"
          ? { ...created, doorType: "opening" as const }
          : created;
    updateRoom(roomId, (r) => ({ ...r, symbols: [...r.symbols, symbol] }));
    setSelectedRoomId(roomId);
    setSelectedSymbolId(symbol.id);
    // Back to select after each placement — a sticky tool means the next tap meant for measuring
    // silently drops another door instead.
    setTool("select");
  }

  const summary = sketchSummaryText(sketch);
  const zoomPercent = Math.round(view.scale * 100);

  return (
    <div className={`card sketch-card${expanded ? " sketch-card-expanded" : ""}`}>
      <div className="sketch-header">
        <div>
          <h2>Sketch</h2>
          {/* The blurb is the first thing to go when the sketch takes the screen — at that point the
              PM is drawing, not being introduced to the feature, and the room for the canvas is
              worth more than the sentence. */}
          {!expanded && (
            <p className="subtitle" style={{ margin: 0 }}>
              {mode === "sketch"
                ? "Optional. Draw each affected room, tap a wall to enter its real length, and place doors, windows and cabinets."
                : "Mark where the damage is. Tap a wall for a reading, or highlight the wet floor. The room itself stays as you drew it."}
            </p>
          )}
        </div>
        <div className="option-group" role="group" aria-label="Mode">
          {([
            { value: "sketch", label: "Sketch" },
            { value: "moisture", label: "Moisture" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`option-btn${mode === option.value ? " selected" : ""}`}
              aria-pressed={mode === option.value}
              disabled={option.value === "moisture" && sketch.rooms.length === 0}
              onClick={() => {
                setMode(option.value);
                setTool("select");
                setNewReadingId(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/*
          Viewing or editing, stated rather than implied. The label says what is happening NOW, and
          the button says what pressing it will do — a control that reads "Editing" while you are
          only looking is the one people press by accident.
        */}
        <button
          type="button"
          className={`option-btn${readOnly ? " selected" : ""}`}
          aria-pressed={readOnly}
          onClick={() => setReadOnly((v) => !v)}
          title={readOnly ? "Unlock to make changes" : "Lock, so nothing can be changed by accident"}
        >
          {readOnly ? "🔒 View only" : "Editing"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Back to the page (Esc)" : "Give the sketch the whole screen"}
        >
          {expanded ? "Exit full screen" : "Full screen"}
        </button>
        {/*
          The way out, and it looks like it.

          It was a secondary button in a row of secondary buttons, which on a phone stacks into a
          column where nothing says which one ends the task — reported as getting lost. It is the
          primary action of this screen once the drawing is done, so it is styled as one.

          Still hidden in full screen: Exit full screen is the way back from there, and it sits right
          beside this.
        */}
        {!expanded && (
          <button className="btn-primary sketch-done" onClick={onClose}>
            Done — back to claim
          </button>
        )}
      </div>

      {readOnly ? null : mode === "moisture" ? (
        <div className="sketch-toolbar" role="toolbar" aria-label="Moisture tools">
          <div className="option-group" role="group" aria-label="Moisture tool">
            {([
              { value: "read", label: "Wall reading" },
              { value: "paint", label: "Highlight" },
              { value: "erase", label: "Erase" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`option-btn${moistureTool === option.value ? " selected" : ""}`}
                aria-pressed={moistureTool === option.value}
                onClick={() => setMoistureTool(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/*
            Which surface the brush paints — shown only with a brush in hand.

            These were briefly always visible, to make the ceiling discoverable. That traded one
            problem for a worse one: with no brush selected they are buttons that visibly do nothing,
            which reads as broken rather than as inapplicable. Discoverability is handled instead by
            the tool being called "Highlight" rather than "Highlight floor" — pressing it and then
            being asked which surface is a sequence that explains itself.
          */}
          {(moistureTool === "paint" || moistureTool === "erase") && (
            <div className="option-group" role="group" aria-label="Surface to highlight">
              {([
                { value: "floor", label: "Floor" },
                { value: "ceiling", label: "Ceiling" },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`option-btn${paintSurface === option.value ? " selected" : ""}`}
                  aria-pressed={paintSurface === option.value}
                  onClick={() => setPaintSurface(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {/* The clean sketch is one toggle away, because it is the same drawing without this layer. */}
          <button
            type="button"
            className={`option-btn${showMoisture ? " selected" : ""}`}
            aria-pressed={showMoisture}
            onClick={() => setShowMoisture((v) => !v)}
          >
            Show moisture
          </button>
          <div className="sketch-zoom">
            <button type="button" className="btn-secondary" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale / 1.2) }))}>
              −
            </button>
            <span className="sketch-zoom-level">{zoomPercent}%</span>
            <button type="button" className="btn-secondary" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale * 1.2) }))}>
              +
            </button>
          </div>
        </div>
      ) : (
      <>
      {/*
        The storeys, and what is traced under the one being drawn.

        Above the tools rather than among them: which floor you are on frames everything else in the
        toolbar, and a level control sitting between Door and Window would read as another thing to
        place. The order is physical — lowest at the left, highest at the right — so the row matches
        the building rather than the order the levels were added in.
      */}
      <div className="sketch-levels" role="toolbar" aria-label="Levels">
        <button type="button" className="btn-secondary" onClick={() => handleAddLevel(-1)} title="Add a storey below the lowest one">
          + Level below
        </button>
        <div className="option-group" role="group" aria-label="Level being drawn">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={`option-btn${level === activeLevel ? " selected" : ""}`}
              aria-pressed={level === activeLevel}
              onClick={() => handleSwitchLevel(level)}
            >
              {levelLabel(level)}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary" onClick={() => handleAddLevel(1)} title="Add a storey above the highest one">
          + Level above
        </button>
        {levels.length > 1 && (
          <label className="sketch-underlay">
            {/* "Trace over" named one use of this and undersold it — mostly it is just seeing what
                is above or below while you work, and tracing is one thing you might do with that. */}
            <span>Also show</span>
            <select
              value={resolvedUnderlay === null ? "none" : String(resolvedUnderlay)}
              onChange={(e) => {
                setUnderlayTouched(true);
                setUnderlayLevel(e.target.value === "none" ? null : Number(e.target.value));
              }}
            >
              <option value="none">Nothing</option>
              {levels
                .filter((level) => level !== activeLevel)
                .map((level) => (
                  <option key={level} value={String(level)}>
                    {levelLabel(level)}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className="sketch-toolbar" role="toolbar" aria-label="Sketch tools">
        <button type="button" className="btn-secondary" onClick={handleAddRoom}>
          + Add room
        </button>
        {/* Stairs are a room, not a fitting — see `StairsData`. Added the same way one is. */}
        <button type="button" className="btn-secondary" onClick={handleAddStairs}>
          + Add stairs
        </button>
        <div className="option-group" role="group" aria-label="Placement tool">
          {([
            { tool: "break", label: "Break" },
            { tool: "door", label: "Door" },
            /* A missing wall or a cased opening: the same hole in a wall, described by width and
               head height rather than by a leaf. */
            { tool: "opening", label: "Opening" },
            { tool: "window", label: "Window" },
            { tool: "cabinet", label: "Cabinet" },
            { tool: "island", label: "Island" },
          ] as { tool: ToolMode; label: string }[]).map((option) => (
            <button
              key={option.tool}
              type="button"
              className={`option-btn${tool === option.tool ? " selected" : ""}`}
              aria-pressed={tool === option.tool}
              disabled={sketch.rooms.length === 0}
              onClick={() => setTool(tool === option.tool ? "select" : option.tool)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/*
          Picking a fixture arms the tool in the same action — two steps for one intent would just be
          a way to have the wrong fixture selected.
        */}
        <select
          className={`sketch-fixture-select${tool === "fixture" ? " selected" : ""}`}
          aria-label="Fixture to place"
          value={tool === "fixture" ? pendingFixture : ""}
          disabled={sketch.rooms.length === 0}
          onChange={(e) => {
            if (e.target.value === "") {
              setTool("select");
              return;
            }
            setPendingFixture(e.target.value as FixtureType);
            setTool("fixture");
          }}
        >
          <option value="">Fixture…</option>
          {(Object.keys(FIXTURE_LABEL) as FixtureType[]).map((type) => (
            <option key={type} value={type}>
              {FIXTURE_LABEL[type]}
            </option>
          ))}
        </select>

        <button type="button" className={`option-btn${showSizes ? " selected" : ""}`} aria-pressed={showSizes} onClick={() => setShowSizes((v) => !v)}>
          Sizes
        </button>
        <div className="sketch-zoom">
          <button type="button" className="btn-secondary" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale / 1.2) }))}>
            −
          </button>
          <span className="sketch-zoom-level">{zoomPercent}%</span>
          <button type="button" className="btn-secondary" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale * 1.2) }))}>
            +
          </button>
          <button type="button" className="btn-secondary" onClick={() => setView(defaultView())}>
            Reset
          </button>
        </div>
      </div>
      </>
      )}

      {/*
        Two columns when expanded, one stacked flow when not — see `.sketch-body` in globals.css.
        The DOM order is the same either way, so nothing about the page layout depends on which one
        is in force.
      */}
      <div className="sketch-body">
      <div className="sketch-stage">
      {deletedRoom && (
        <div className="sketch-undo" role="status">
          <span>Room deleted.</span>
          <button type="button" className="btn-secondary" onClick={restoreRoom}>
            Undo
          </button>
        </div>
      )}

      {/* The hint follows the MODE first: the sketching instructions describe gestures that are
          switched off while mapping, so leaving them up told the PM to do impossible things. */}
      <p className="field-note sketch-hint">
        {mode === "moisture"
          ? moistureTool === "read"
            ? "Tap a wall to record a reading there. Drag either end of a mark to cover only the wet run."
            : `${moistureTool === "erase" ? "Drag to erase" : "Drag to highlight"} the affected ${paintSurface}. Pinch to zoom.`
          : sketch.rooms.length === 0
          ? "Add a room to start."
          : tool === "select"
            ? "Tap to select, drag to move. Double-tap a wall or its measurement to type its length. For an L: tap Break, tap a wall, then drag one half out. Drag empty space to pan; pinch to zoom."
            : tool === "island"
              ? "Tap open floor inside the room to drop a free-standing cabinet."
              : tool === "break"
                ? "Tap a wall where you want a new corner, then drag that corner or either half of the wall to shape it."
                : tool === "fixture"
                  ? `Tap the wall where the ${FIXTURE_LABEL[pendingFixture].toLowerCase()} goes.`
                  : tool === "opening"
                    ? "Tap the wall where the opening goes. Drag either end to set how wide it is."
                    : `Tap the wall where the ${SYMBOL_LABEL[tool as SymbolType].toLowerCase()} goes.`}
      </p>

      <div className={`sketch-canvas-wrap${readOnly ? " sketch-canvas-readonly" : ""}`} ref={containerRef}>
        <SketchCanvas
          rooms={activeRooms}
          underlayRooms={underlayRooms}
          width={canvasWidth}
          height={canvasHeight}
          view={view}
          tool={tool}
          showSizes={showSizes}
          moisture={moisture}
          showMoisture={showMoisture && mode === "moisture"}
          moistureTool={mode === "moisture" ? moistureTool : null}
          paintSurface={paintSurface}
          selectedReadingId={selectedReadingId}
          onTapWallForReading={handleTapWallForReading}
          onSelectReading={(roomId, readingId) => {
            // Both, always — see `onSelectReading` on the canvas for what happens when they drift.
            setSelectedRoomId(roomId);
            setSelectedReadingId(readingId);
          }}
          onResizeReading={handleResizeReading}
          onPaintFloor={handlePaintFloor}
          selectedRoomId={selectedRoomId}
          selectedSymbolId={selectedSymbolId}
          onViewChange={setView}
          onSelectRoom={setSelectedRoomId}
          onSelectSymbol={setSelectedSymbolId}
          onMoveRoom={handleMoveRoom}
          onTapWall={handleTapWall}
          onPlaceSymbol={handlePlaceSymbol}
          onRenameRoom={(roomId, screen) => {
            setNameDraft(sketch.rooms.find((r) => r.id === roomId)?.name ?? "");
            setPendingName({ roomId, screen });
          }}
          onSplitWall={(roomId, wallId, t) => {
            // A double-tap's FIRST tap opens the length prompt; dismiss it so the break doesn't
            // leave a stray keyboard up behind it. Harmless when the break came from the tool.
            setPendingLength(null);
            setTool("select");
            updateRoom(roomId, (room) => insertVertexOnWall(room, wallId, t));
          }}
          onDragWall={(roomId, wallId, dx, dy) => updateRoom(roomId, (room) => dragWall(room, wallId, dx, dy))}
          onDragWallEnd={(roomId, wallId) => updateRoom(roomId, (room) => snapWallToNeighbours(room, wallId))}
          onMoveVertex={(roomId, vertexId, x, y) => updateRoom(roomId, (room) => moveVertex(room, vertexId, x, y))}
          onRemoveVertex={(roomId, vertexId) => updateRoom(roomId, (room) => removeVertex(room, vertexId))}
          onMoveSymbol={(roomId, symbolId, centrePx) =>
            /*
              `sketch.rooms` is passed so a cabinet knows which sub-rooms stand on its wall — a
              closet inside a bedroom takes its share of that wall, and a run of cabinets stops
              where it begins rather than carrying on underneath it. See `blockRunPx`.
            */
            updateSymbol(roomId, symbolId, (symbol, room) => moveSymbolAlongWall(symbol, room, centrePx, sketch.rooms))
          }
          onResizeSymbol={(roomId, symbolId, centrePx, widthPx) =>
            updateSymbol(roomId, symbolId, (symbol, room) =>
              moveSymbolAlongWall(withSymbolWidthPx(symbol, room, widthPx, sketch.rooms), room, centrePx, sketch.rooms),
            )
          }
          onPlaceIsland={handlePlaceIsland}
          onMoveIsland={(roomId, islandId, x, y) => updateIsland(roomId, islandId, (cabinet, room) => moveFreeCabinet(cabinet, room, x, y))}
          onResizeIsland={(roomId, islandId, widthPx, depthPx) =>
            // Resize then re-clamp: growing an island near a wall would otherwise push it through one.
            updateIsland(roomId, islandId, (cabinet, room) => {
              const resized = withFreeCabinetSizePx(cabinet, room, widthPx, depthPx);
              return moveFreeCabinet(resized, room, resized.x, resized.y);
            })
          }
        />

        {pendingName && (
          <CanvasTextInput
            label="Room name"
            screen={pendingName.screen}
            value={nameDraft}
            placeholder="e.g. Basement Bedroom"
            listId="sketch-known-rooms"
            onChange={setNameDraft}
            onSubmit={() => {
              updateRoom(pendingName.roomId, (room) => ({ ...room, name: nameDraft }));
              setPendingName(null);
            }}
            onCancel={() => setPendingName(null)}
          />
        )}

        {pendingLength && (
          <CanvasTextInput
            label="Wall length"
            placeholder={`12'6" or 12.5`}
            screen={pendingLength.screen}
            value={lengthDraft}
            error={lengthError}
            onChange={(v) => {
              setLengthDraft(v);
              setLengthError(null);
            }}
            onSubmit={handleSubmitLength}
            onCancel={() => {
              setPendingLength(null);
              setLengthError(null);
            }}
          />
        )}

        {/*
          Turning things round, on the drawing rather than below it.

          This is the direct answer to the complaint: the swing of a door and the run of a flight
          were only changeable from the properties panel, which on a phone sits far enough below the
          canvas that the thing being turned scrolls out of sight while you turn it. The same
          controls float over the corner of the canvas, so the change and its result are in one
          glance. The panel keeps its copies — this is a shortcut, not a relocation.
        */}
        <DirectionControls
          /* Sketch mode only. Mapping puts the geometry into read-only — corners, wall grips and
             symbol handles all stand down — and turning a flight there would move the very walls the
             readings are attached to. */
          room={mode === "sketch" ? selectedRoom : null}
          symbol={mode === "sketch" ? selectedSymbol : null}
          onFlipDoor={(axis) =>
            selectedRoom &&
            selectedSymbol &&
            updateSymbol(selectedRoom.id, selectedSymbol.id, (symbol) =>
              symbol.type !== "door" ? symbol : axis === "x" ? { ...symbol, flipX: !symbol.flipX } : { ...symbol, flipY: !symbol.flipY },
            )
          }
          onRotateStairs={() => selectedRoom && updateRoom(selectedRoom.id, (room) => rotateStairs(room))}
          onFlipStairs={() =>
            selectedRoom &&
            updateRoom(selectedRoom.id, (room) =>
              room.stairs ? { ...room, stairs: { ...room.stairs, direction: room.stairs.direction === "up" ? "down" : "up" } } : room,
            )
          }
        />
      </div>
      </div>

      <div className="sketch-side">

      {mode === "moisture" && <MoistureLegend />}

      {mode === "moisture" && selectedRoom && (
        <MoisturePanel
          room={selectedRoom}
          data={roomMoisture(moisture, selectedRoom.id)}
          highlightReadingId={newReadingId}
          onChange={(next) => updateRoomMoisture(selectedRoom.id, () => next)}
          /*
            The whole map, because the dry standard is a property of the BUILDING rather than of this
            room — one reference reading per material for the job. Setting it also rewrites the walls
            still sitting on a guessed number, which reaches outside this room.
          */
          reference={moisture.reference}
          onSetReference={(material, value) => onMoistureChange(setReferenceReading(moisture, material, value))}
        />
      )}

      {mode === "moisture" && !selectedRoom && (
        <p className="field-note sketch-hint">Tap a room to record its moisture readings.</p>
      )}

      {/* Below the readings it is derived from, and only when there is a map to derive it from. */}
      {mode === "moisture" && (
        <EquipmentPanel
          sketch={sketch}
          moisture={moisture}
          settings={equipmentSettings}
          statedEquipment={statedEquipment}
          onSettingsChange={setEquipmentSettings}
          onResolveEquipment={onResolveEquipment}
        />
      )}

      {mode === "sketch" && selectedRoom && (
        <div className="sketch-panel">
          <div className="question">
            <label className="prompt" htmlFor="sketch-room-name">
              Room name
            </label>
            {/*
              A datalist rather than a fixed dropdown: the suggestions are the room names already in
              this claim, so a sketch room can be matched back to the scope — but a PM may legitimately
              sketch a room the transcript never mentioned, and a closed list would block that.
            */}
            <input
              id="sketch-room-name"
              type="text"
              list="sketch-known-rooms"
              value={selectedRoom.name}
              placeholder="e.g. Basement Bedroom"
              onChange={(e) => updateRoom(selectedRoom.id, (room) => ({ ...room, name: e.target.value }))}
            />
            <datalist id="sketch-known-rooms">
              {knownRoomNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {knownRoomNames.length > 0 && <p className="field-note">Suggestions come from rooms already named in this claim.</p>}
          </div>


          {/*
            Sits directly under the name rather than below the measurements, because it only appears
            sometimes and a control that appears sometimes has to appear somewhere you're already
            looking. Shown whenever the geometry puts this room inside another, whichever way the
            choice currently falls — otherwise opting out would hide the control that undoes it.
          */}
          {nestedInside && (
            <div className="question">
              <label className="prompt">This room is drawn inside {nestedInside.name.trim() || "another room"}</label>
              <div className="option-group" role="group" aria-label="Sub-room">
                <button
                  type="button"
                  className={`option-btn${!selectedRoom.nestingOptOut ? " selected" : ""}`}
                  aria-pressed={!selectedRoom.nestingOptOut}
                  onClick={() => setNesting(selectedRoom.id, false)}
                >
                  Sub-room of it
                </button>
                <button
                  type="button"
                  className={`option-btn${selectedRoom.nestingOptOut ? " selected" : ""}`}
                  aria-pressed={selectedRoom.nestingOptOut}
                  onClick={() => setNesting(selectedRoom.id, true)}
                >
                  Separate room
                </button>
              </div>
            </div>
          )}

          {/*
            A stair room's ceiling is not a setting — it climbs with the flight, so the height and
            shape controls are replaced by the flight's own. See `stairCeiling`.
          */}
          {selectedRoom.stairs ? (
            <StairsRoomFields
              room={selectedRoom}
              onChange={(next) => updateRoom(selectedRoom.id, () => next)}
              onRotate={() => updateRoom(selectedRoom.id, (room) => rotateStairs(room))}
            />
          ) : (
            <>
          {/*
            Ceiling height. Not cosmetic and not derivable from the plan: floor area comes from the
            polygon, but the cubic volume that drives IICRC equipment sizing needs this third
            dimension. Nothing computes with it yet — this is the input that calculation was waiting
            on.
          */}
          <div className="question">
            <label className="prompt" htmlFor="sketch-ceiling">
              Ceiling height
            </label>
            <input
              id="sketch-ceiling"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder={`8'`}
              defaultValue={selectedRoom.ceilingHeightFeet == null ? "" : formatFeetInches(selectedRoom.ceilingHeightFeet)}
              key={`${selectedRoom.id}-ceiling`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  updateRoom(selectedRoom.id, (room) => ({ ...room, ceilingHeightFeet: null }));
                  return;
                }
                const feet = parseFeetInches(raw);
                if (feet == null || feet <= 0) {
                  // Put the last good value back rather than silently keeping unparseable text.
                  e.target.value = selectedRoom.ceilingHeightFeet == null ? "" : formatFeetInches(selectedRoom.ceilingHeightFeet);
                  return;
                }
                updateRoom(selectedRoom.id, (room) => ({ ...room, ceilingHeightFeet: feet }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <p className="field-note">Defaults to {formatFeetInches(DEFAULT_CEILING_HEIGHT_FEET)} — only worth changing when it isn&rsquo;t. Drives wall area, stair rise, and later volume-based equipment sizing.</p>
          </div>

          <div className="question">
            <label className="prompt">Ceiling shape</label>
            <div className="option-group" role="group" aria-label="Ceiling shape">
              {(Object.keys(CEILING_TYPE_LABEL) as CeilingType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`option-btn${selectedRoom.ceilingType === type ? " selected" : ""}`}
                  aria-pressed={selectedRoom.ceilingType === type}
                  onClick={() =>
                    updateRoom(selectedRoom.id, (room) => ({
                      ...room,
                      ceilingType: type,
                      // Give a shaped ceiling a starting peak so the numbers mean something at once.
                      ceilingPeakFeet: type === "flat" ? null : (room.ceilingPeakFeet ?? (room.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET) + 2),
                    }))
                  }
                >
                  {CEILING_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
            {selectedRoom.ceilingType !== "flat" && (
              <>
                <label className="prompt" htmlFor="sketch-ceiling-peak" style={{ marginTop: 12 }}>
                  Peak height
                </label>
                <input
                  id="sketch-ceiling-peak"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder={`10'`}
                  key={`${selectedRoom.id}-peak`}
                  defaultValue={selectedRoom.ceilingPeakFeet == null ? "" : formatFeetInches(selectedRoom.ceilingPeakFeet)}
                  onBlur={(e) => {
                    const feet = parseFeetInches(e.target.value.trim());
                    if (feet == null || feet <= 0) {
                      e.target.value = selectedRoom.ceilingPeakFeet == null ? "" : formatFeetInches(selectedRoom.ceilingPeakFeet);
                      return;
                    }
                    updateRoom(selectedRoom.id, (room) => ({ ...room, ceilingPeakFeet: feet }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
                <p className="field-note">
                  The height above is the low point. Wall area uses the average of the two; ceiling area follows the slope, so it comes out larger than the floor.
                </p>
              </>
            )}
          </div>
            </>
          )}


          {selectedSymbol ? (
            <>
              <h3 className="sketch-panel-title">{SYMBOL_LABEL[selectedSymbol.type]}</h3>
              <SymbolPanel
                room={selectedRoom}
                symbol={selectedSymbol}
                onChange={(next) => updateSymbol(selectedRoom.id, next.id, () => next)}
                onDelete={() => {
                  updateRoom(selectedRoom.id, (room) => ({ ...room, symbols: room.symbols.filter((s) => s.id !== selectedSymbol.id) }));
                  setSelectedSymbolId(null);
                }}
              />
            </>
          ) : selectedIsland ? (
            <>
              <h3 className="sketch-panel-title">Island</h3>
              <FreeCabinetPanel
                room={selectedRoom}
                cabinet={selectedIsland}
                onChange={(next) => updateIsland(selectedRoom.id, next.id, () => next)}
                onDelete={() => {
                  updateRoom(selectedRoom.id, (room) => ({ ...room, freeCabinets: room.freeCabinets.filter((c) => c.id !== selectedIsland.id) }));
                  setSelectedSymbolId(null);
                }}
              />
            </>
          ) : (
            <div className="actions-row">
              <button className="btn-secondary" onClick={() => handleDeleteRoom(selectedRoom.id)} title="Delete key">
                Delete room
              </button>
            </div>
          )}
        </div>
      )}

      <QuantitiesPanel sketch={sketch} options={quantityOptions} onOptionsChange={setQuantityOptions} />

      {summary && (
        <div className="sketch-summary">
          <h3>Sketch data</h3>
          <p className="field-note">
            This is what the sketch actually produces — wall lengths and symbol positions, not just a picture. It stays with the claim for this session.
          </p>
          <pre className="document-text">{summary}</pre>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

/**
 * The turn-it-round controls, floated over the canvas.
 *
 * Shown only when there is something to turn, which is a door or a stair room. Everything else in
 * the tool is either dragged into place or typed, so a permanent control here would be occupied
 * doing nothing most of the time and would cover the drawing while it did.
 *
 * The labels describe the ACTION, not the outcome, for the reason given at the door's own panel:
 * whether a horizontal mirror moves the hinge or the swing depends on which wall the door is on, so
 * "flip across" is the only description that stays true on all four walls.
 */
function DirectionControls({
  room,
  symbol,
  onFlipDoor,
  onRotateStairs,
  onFlipStairs,
}: {
  room: SketchRoom | null;
  symbol: SketchSymbol | null;
  onFlipDoor: (axis: "x" | "y") => void;
  onRotateStairs: () => void;
  onFlipStairs: () => void;
}) {
  // An opening has no leaf, so there is nothing to hand or swing — same exclusion the panel makes.
  const door = symbol?.type === "door" && symbol.doorType !== "opening" ? symbol : null;
  const stairs = !symbol && room?.stairs ? room.stairs : null;
  if (!door && !stairs) return null;

  return (
    <div className="sketch-direction" role="group" aria-label={door ? "Door orientation" : "Stair direction"}>
      {door && (
        <>
          <button type="button" className="btn-secondary" onClick={() => onFlipDoor("x")} title="Mirror left to right (← →)">
            ⇆ Flip
          </button>
          <button type="button" className="btn-secondary" onClick={() => onFlipDoor("y")} title="Mirror top to bottom (↑ ↓)">
            ⇅ Flip
          </button>
        </>
      )}
      {stairs && (
        <>
          <button type="button" className="btn-secondary" onClick={onRotateStairs} title="Turn a quarter turn (← →)">
            ↻ Turn
          </button>
          <button type="button" className="btn-secondary" onClick={onFlipStairs} title="Which way it climbs (↑ ↓)">
            {stairs.direction === "up" ? "↑ Up" : "↓ Down"}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A stair room's own properties.
 *
 * Deliberately short: the run, the width and the tread count are all read off the shape on the
 * canvas, so there is nothing to type for any of them. What is left is the handful of things the
 * drawing cannot show — which way it climbs, how it is turned, how deep a tread is, and the rise, if
 * the standard storey assumption is wrong.
 *
 * The ceiling is absent on purpose. It climbs with the flight and is worked out from the rise; see
 * `stairCeiling`.
 */
function StairsRoomFields({ room, onChange, onRotate }: { room: SketchRoom; onChange: (next: SketchRoom) => void; onRotate: () => void }) {
  const stairs = room.stairs;
  if (!stairs) return null;
  const flight = stairFlight(room);
  const ceiling = stairCeiling(room);
  const steep = flight.riserFeet != null && flight.riserFeet > 7.75 / 12;

  return (
    <>
      <div className="question">
        <label className="prompt">Flight</label>
        <p className="field-note" style={{ margin: 0 }}>
          <strong>{flight.treadCount}</strong> treads
          {flight.runFeet != null && flight.widthFeet != null && (
            <>
              {" "}
              — {formatFeetInches(flight.runFeet)} run x {formatFeetInches(flight.widthFeet)} wide
            </>
          )}
          {flight.riserFeet != null && (
            <>
              , {formatSmallDimension(flight.riserFeet)} risers
              {steep && <span className="sketch-length-error"> (steeper than 7¾&quot;)</span>}
            </>
          )}
          .
        </p>
        <p className="field-note">Drag the walls to set the run and width. Ceiling climbs with the flight: {formatFeetInches(ceiling.lowFeet)} at the bottom, {formatFeetInches(ceiling.peakFeet)} at the top.</p>
      </div>

      <div className="question">
        <label className="prompt">Direction</label>
        <div className="option-group" role="group" aria-label="Stair direction">
          {(["up", "down"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              className={`option-btn${stairs.direction === dir ? " selected" : ""}`}
              aria-pressed={stairs.direction === dir}
              onClick={() => onChange({ ...room, stairs: { ...stairs, direction: dir } })}
            >
              {dir === "up" ? "Up" : "Down"}
            </button>
          ))}
        </div>
        <div className="actions-row" style={{ marginTop: 12, justifyContent: "flex-start" }}>
          <button className="btn-secondary" onClick={onRotate}>
            Rotate a quarter turn
          </button>
        </div>
        <p className="field-note">On a desktop keyboard, ← → turn the flight and ↑ ↓ set which way it climbs.</p>
      </div>

      <MeasureRoomField
        id="stairs-rise"
        label="Total rise"
        hint="Floor to floor. Leave it unless you measured it — it also sets how high the ceiling climbs."
        valueFeet={flight.riseFeet}
        onCommit={(feet) => onChange({ ...room, stairs: { ...stairs, riseFeet: feet } })}
      />
      <MeasureRoomField
        id="stairs-tread"
        label="Tread depth"
        hint="Front to back on one step. Drives how many treads fit the run."
        valueFeet={stairs.treadDepthFeet}
        onCommit={(feet) => onChange({ ...room, stairs: { ...stairs, treadDepthFeet: feet } })}
      />
    </>
  );
}

/** A feet-and-inches field for a room-level value. Commits on blur or Enter, reverts what it can't read. */
function MeasureRoomField({ id, label, hint, valueFeet, onCommit }: { id: string; label: string; hint?: string; valueFeet: number | null; onCommit: (feet: number) => void }) {
  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        key={`${id}-${valueFeet ?? "none"}`}
        defaultValue={valueFeet == null ? "" : formatFeetInches(valueFeet)}
        onBlur={(e) => {
          const feet = parseFeetInches(e.target.value.trim());
          if (feet == null || feet <= 0) {
            e.target.value = valueFeet == null ? "" : formatFeetInches(valueFeet);
            return;
          }
          onCommit(feet);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {hint && <p className="field-note">{hint}</p>}
    </div>
  );
}

/**
 * A one-field input floated over the canvas at the point that was tapped.
 *
 * Explicitly NOT `window.prompt()`. The native dialog is unreliable on mobile browsers — some
 * suppress it entirely, and it steals focus in ways that break the touch interaction that opened
 * it. This is a normal focused input, so it behaves like every other field on the page.
 *
 * Shared by the wall-length prompt and the rename box, so both sit correctly, both stay on screen,
 * and both take Enter and Escape the same way.
 */
function CanvasTextInput({
  label,
  screen,
  value,
  placeholder,
  listId,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  screen: { x: number; y: number };
  value: string;
  placeholder: string;
  /** Optional <datalist> id, for the rename box's room-name suggestions. */
  listId?: string;
  error?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: screen.x, top: screen.y });

  /*
    Focus the field on a mouse, but NOT on a touchscreen.

    Autofocus is right with a keyboard already present — you tap a wall and start typing. On a phone
    it throws up the on-screen keyboard the instant a wall is touched, which covers half the sketch,
    resizes the viewport out from under the canvas, and hijacks any gesture that only grazed a wall
    on its way somewhere else. The field is still one tap away when the number is actually wanted.
  */
  useEffect(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Keep the popup fully on screen — something tapped near the right edge would otherwise open an
  // input running off the viewport, which on a phone is simply unusable.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, screen.x - rect.width / 2), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(margin, screen.y - rect.height - 12), window.innerHeight - rect.height - margin);
    setPos({ left, top });
  }, [screen.x, screen.y]);

  const id = `sketch-canvas-input-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div ref={boxRef} className="sketch-length-popup" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={label}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        // `text`, not `number`: a number input rejects 12'6" outright, and on iOS it also strips
        // the quote characters as you type.
        inputMode="text"
        autoComplete="off"
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      {error && <p className="sketch-length-error">{error}</p>}
      <div className="sketch-length-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={onSubmit}>
          Set
        </button>
      </div>
    </div>
  );
}
