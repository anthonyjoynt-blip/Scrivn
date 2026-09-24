"use client";

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { importScanRoom, scanExtentPx } from "@/lib/scanImport";
import {
  type DoorType,
  type FreeCabinet,
  type FreeWall,
  type Sketch,
  type SketchRoom,
  type SketchSymbol,
  type SketchView,
  type Vertex,
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
  closetBehindDoor,
  closetExistsBehind,
  ensureClockwise,
  exposedRunAt,
  formatFeetInches,
  formatSmallDimension,
  insertVertexOnWall,
  labelShown,
  moveFreeCabinet,
  moveSymbolAlongWall,
  moveVertex,
  newFreeCabinet,
  newSketchId,
  newSymbol,
  nextRoomName,
  parseFeetInches,
  possibleParents,
  pruneCollinearVertices,
  newStairRoom,
  rectangleVertices,
  removeVertex,
  rotateStairs,
  roomLevel,
  DOOR_TYPE_LABEL,
  STAIRS_DEFAULT,
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
  wallRunFeet,
  wallsOf,
  withFixtureType,
  withFreeCabinetSizePx,
  withSymbolWidthPx,
  withWallRunLength,
  defaultUnderlayLevel,
  fitView,
  freeWallSegments,
  freeWallsOf,
  freeWallsOnLevel,
  levelBounds,
  levelLabel,
  levelsOf,
  openingLevel,
  roomsOnLevel,
  withLevel,
} from "@/lib/sketch";
import {
  PHONE_LAYOUT_QUERY,
  SKETCH_BAR_KEYS,
  SKETCH_DESKTOP_LEADING,
  SKETCH_DESKTOP_TRAILING,
  SKETCH_PLACEMENT_KEYS,
  moistureKeys,
  sketchMoreKeys,
  type MoistureToolKey,
  type SketchToolKey,
} from "@/lib/sketchTouch";
import {
  type DraftPoint,
  addDraftPoint,
  connectedFreeWallIds,
  finishDraft,
  freeWallsAttachedToRoom,
  moveSharedFreeWallVertex,
  snapDraftPoint,
  snapFreeWallTranslation,
  translateFreeWall,
  wallSnapRadiusPx,
  withFreeWallSegmentLength,
} from "@/lib/sketchWalls";
import { FreeCabinetPanel, SymbolPanel } from "./SymbolPanel";
import { type Obstacle, conformedDragWall, obstaclesFor, placeNewRoom, pullRoomFromWall, viewCentredOn, wallDragMeetsWall } from "@/lib/roomPlacement";
import { QuantitiesPanel } from "./QuantitiesPanel";
import { type QuantityOptions, DEFAULT_QUANTITY_OPTIONS } from "@/lib/sketchQuantities";
import { SQUARE_TOLERANCE_DEG, leaningCorners, squareUpRoom } from "@/lib/sketchSquare";
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
/** "20' x 16'" — what tells two rooms called Closet apart in the "Sub-room of" list. */
function roomSizeLabel(room: SketchRoom): string {
  const b = roomBounds(room);
  return `${formatFeetInches(b.width / PIXELS_PER_FOOT)} x ${formatFeetInches(b.height / PIXELS_PER_FOOT)}`;
}

const NEW_ROOM = {
  width: DEFAULT_ROOM_FEET * PIXELS_PER_FOOT,
  height: DEFAULT_ROOM_FEET * PIXELS_PER_FOOT,
  gap: 30,
};

type PendingLength =
  | {
      kind: "room";
      roomId: string;
      wallId: string;
      /** Viewport coordinates of the tap, so the input can appear next to the wall rather than in a modal. */
      screen: { x: number; y: number };
      /**
       * The stretch of the wall being measured, as fractions — `[0, 1]` for the whole wall, less where a
       * sub-room stands against part of it. The prompt shows and sets THIS length, which is the one on
       * the label the PM tapped and the one their tape can find — see `withWallRunLength`.
       */
      run: [number, number];
    }
  /** One piece of a free wall, named by the corner it starts at — see `withFreeWallSegmentLength`. */
  | { kind: "freeWall"; wallId: string; vertexId: string; screen: { x: number; y: number } };

/**
 * Whether the editor should lay itself out for a finger — see `PHONE_LAYOUT_QUERY`.
 *
 * False until mounted, on purpose: the server has no viewport to measure, and a layout guessed
 * during rendering and corrected afterwards is a flash of the wrong screen. The desktop layout is
 * the one that survives being wrong for a frame.
 */
function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE_LAYOUT_QUERY);
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return phone;
}

/** How far a finger may travel and still count as a tap rather than a drag. */
const TAP_SLOP_PX = 8;

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
  notice,
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
  /**
   * A strip the page wants shown with the drawing — a scan that has just arrived from the phone, or
   * the receipt for one applied. Rendered here, beside the editor's own notices, rather than above
   * the card, because in full screen the card covers everything else on the page and news about the
   * drawing has to be where the drawing is.
   */
  notice?: ReactNode;
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
  /** The corners tapped so far with the wall tool — see `lib/sketchWalls.ts`. Empty when not drawing. */
  const [wallDraft, setWallDraft] = useState<DraftPoint[]>([]);
  /** Why the last tap with the wall tool drew nothing, shown in place of the hint until the next tap. */
  const [wallNotice, setWallNotice] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  /** The last free wall deleted, for the same one-step undo a room gets — see `deletedRoom`. */
  const [deletedWall, setDeletedWall] = useState<{ wall: FreeWall; index: number } | null>(null);
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
  const [expandedByUser, setExpanded] = useState(false);
  /**
   * A phone is full screen from the moment the sketch opens.
   *
   * The 460px card in a scrolling page is the desktop's shape: on a phone it left a drawing
   * surface the size of a business card under six rows of buttons, and every session began with
   * the same tap on Full screen. Expanded is not a mode there, it is the screen.
   */
  const phone = usePhoneLayout();
  const expanded = phone || expandedByUser;
  /*
    Once the sketch has had the screen it keeps it. A tablet rotated from portrait to landscape
    crosses out of the phone layout, and without this the editor would fold back into the claim
    page mid-drawing — the plan gone behind the form, the page scrolled wherever it had been left.
    Full screen is a control again at that width, so there is still a way back out of it.
  */
  useEffect(() => {
    if (phone) setExpanded(true);
  }, [phone]);
  /**
   * Which bottom sheet is up: the tools behind More, or the properties of what is selected.
   *
   * Phone only — on the desktop the same panels are the right-hand column, which is always up.
   */
  const [sheet, setSheet] = useState<"none" | "more" | "details">("none");
  /**
   * The finger on the plan: where it went down, and whether a selection is waiting for it to lift.
   *
   * A tap selects on pointerDOWN, so the plan can be dragged in the same gesture — which means the
   * sheet cannot simply rise when the selection changes: it would rise under the finger at the
   * start of every drag. The selection is held here instead and shown when the finger lifts, and
   * only if it lifted where it landed.
   */
  const pointerOnPlan = useRef<{ x: number; y: number } | null>(null);
  const detailsWaiting = useRef(false);
  /** The More button, so closing a sheet hands focus back to the bar and not to the document. */
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Which storey is being drawn, and which other one is traced underneath it.
   *
   * Editor state rather than sketch data: a level is a fact about the building and belongs on the
   * rooms (see `SketchRoom.level`), but WHICH ONE you happen to be looking at is a view, in exactly
   * the way `view` is. Two people opening the same claim should not inherit each other's tab.
   *
   * Opens on the main level when anything is drawn there, else on the storey last worked on — see
   * `openingLevel`. Read once: the sketch changing under an open editor must not switch its tab.
   */
  const [activeLevel, setActiveLevel] = useState(() => openingLevel(sketch));
  /** Null hides the underlay; otherwise the level being traced. Seeded on first use, see below. */
  const [underlayLevel, setUnderlayLevel] = useState<number | null>(null);
  const [underlayTouched, setUnderlayTouched] = useState(false);

  const levels = useMemo(() => levelsOf(sketch), [sketch]);
  const activeRooms = useMemo(() => roomsOnLevel(sketch, activeLevel), [sketch, activeLevel]);
  const activeFreeWalls = useMemo(() => freeWallsOnLevel(sketch, activeLevel), [sketch, activeLevel]);
  const selectedWall = freeWallsOf(sketch).find((w) => w.id === selectedWallId) ?? null;
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
  /**
   * The corners as they were before the last Square up, for the one step back a delete gets.
   *
   * Squaring moves several corners at once and there is no way to drag them back to where they
   * were, which is the difference between this and every other edit in this panel: a wall you
   * drag, you drag back. So it is offered as an undo rather than trusted to be right.
   */
  const [squared, setSquared] = useState<{ roomId: string; vertices: Vertex[]; count: number } | null>(null);
  /**
   * What the last scan import had to say — a refusal, or the caveats of a room that did come in
   * (no ceiling seen, a gap left as wall). Shown in the same bar as the delete undo, and cleared
   * the same way: by the PM dismissing it.
   *
   * `action` is an offer the notice can make alongside OK — today, to draw a closet behind each
   * door the phone tapped as a closet door. It is an offer and not a default because the PM asked
   * that closets never appear on their own: the import draws the room and the doors, and nothing
   * more until the button is pressed. Taking OK instead declines it, and the doors keep the same
   * button in their own panel for later.
   */
  const [importNotice, setImportNotice] = useState<{
    kind: "error" | "note";
    text: string;
    action?: { label: string; run: () => void };
  } | null>(null);
  const scanFileRef = useRef<HTMLInputElement>(null);

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
    const sizeNow = () => ({
      width: Math.max(280, el.clientWidth),
      height: expanded ? Math.max(240, el.clientHeight) : CANVAS_HEIGHT,
    });
    const measure = () => {
      const { width, height } = sizeNow();
      setCanvasWidth(width);
      setCanvasHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    /*
      Frame the drawing, one frame after the layout rather than during it.

      The stage starts at a guessed 600px, so a fit computed before the canvas is measured frames
      the plan for a canvas that does not exist — on a phone it put the drawing off the right-hand
      edge. Even this effect's own first read is early: the bar and the hint above it have not
      taken their height yet, and the plan lands above the middle of a canvas that then grows. A
      frame later the layout has settled and the numbers are the real ones.

      `sketch` and `activeLevel` are this effect's first values, which is what they are when the
      sketch opens. `framed` makes it once and for all: from here the view is the PM's, and a fit
      that reasserted itself would undo every pan. It is set even when there was nothing to frame,
      so the first room drawn on an empty sketch is not yanked into the middle later.
    */
    let frame = 0;
    if (!framed.current) {
      frame = requestAnimationFrame(() => {
        framed.current = true;
        const bounds = levelBounds(sketch, activeLevel);
        if (bounds === null) return;
        const { width, height } = sizeNow();
        setView(fitView(bounds, width, height));
      });
    }
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [expanded]);

  /** The view that frames what is on this storey, or the origin when there is nothing on it. */
  function fitToLevel(): SketchView {
    return fitView(levelBounds(sketch, activeLevel), canvasWidth, canvasHeight);
  }
  /**
   * Whether the drawing has been framed yet — see the measuring effect, which does it.
   *
   * Set on the canvas's FIRST REAL measurement, and then never again: the view is the PM's from
   * that moment, and a fit that reasserted itself would undo every pan. Set even when there was
   * nothing to frame, so that a room drawn on an empty sketch is not yanked into the middle by the
   * next thing that resizes the canvas.
   */
  const framed = useRef(false);

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
  /** The selected room's corners that are near enough to square to be worth offering. */
  const leaning = useMemo(() => (selectedRoom === null ? [] : leaningCorners(selectedRoom)), [selectedRoom]);
  /**
   * What is selected, as one value, so the phone's properties sheet can rise when it changes.
   *
   * A symbol wins over a wall, and a wall over its room, which is the order the panels below are
   * chosen in: the sheet must show what the tap was aimed at.
   */
  const selectionKey = selectedSymbol
    ? `symbol:${selectedSymbol.id}`
    : selectedWall
      ? `wall:${selectedWall.id}`
      : selectedRoom
        ? `room:${selectedRoom.id}`
        : null;
  /*
    Tap a wall and its properties are there — the whole point of a sheet rather than a column
    below the fold, since typing a length used to mean scrolling away from the wall being typed.

    Not while a finger is down: dragging a room selects it, and a sheet rising over the room you
    are moving is the drawing hiding itself. A drag ends with the sheet still down and the
    properties one tap away on the bar, which is the right answer for a move.
  */
  useEffect(() => {
    if (!phone) return;
    if (selectionKey === null) {
      setSheet((open) => (open === "details" ? "none" : open));
      return;
    }
    if (pointerOnPlan.current !== null) {
      detailsWaiting.current = true;
      return;
    }
    setSheet("details");
  }, [phone, selectionKey]);
  // Islands share `selectedSymbolId` — ids are unique across both collections, and only one thing
  // is ever selected, so a second piece of selection state would only be able to disagree.
  const selectedIsland = selectedRoom?.freeCabinets.find((c) => c.id === selectedSymbolId) ?? null;

  /**
   * The room this one is drawn inside, whatever has been chosen for it.
   *
   * Asked with the opt-out and the choice cleared on purpose: the note under the "Sub-room of" list
   * says where the drawing puts the room, which is worth seeing exactly when the choice disagrees.
   */
  const nestedInside = (() => {
    if (!selectedRoom) return null;
    const asIfNesting = sketch.rooms.map((r) => (r.id === selectedRoom.id ? { ...r, nestingOptOut: false, chosenParentRoomId: null } : r));
    const parentId = containingRoomId(asIfNesting, selectedRoom.id);
    return parentId ? (sketch.rooms.find((r) => r.id === parentId) ?? null) : null;
  })();

  /** What the "Sub-room of" list offers: the other rooms on this storey that are not already under this one. */
  const parentChoices = selectedRoom ? possibleParents(selectedRoom, sketch.rooms) : [];

  /**
   * The PM's answer to "Sub-room of": a room, or none. Explicit either way — a room chosen stays
   * chosen wherever it is dragged, and "Not a sub-room" is the opt-out that survives the same way.
   * See `chosenParentRoomId`.
   */
  function setParentChoice(roomId: string, parentId: string | null) {
    onChange({
      ...sketch,
      rooms: withDerivedParents(sketch.rooms.map((r) => (r.id === roomId ? { ...r, chosenParentRoomId: parentId, nestingOptOut: parentId === null } : r))),
    });
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

      // A run of walls in the making: Escape drops it, Enter keeps it as drawn.
      if (tool === "wall" && wallDraft.length > 0) {
        if (event.key === "Escape") {
          cancelWallDraft();
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          finishWallDraft();
          event.preventDefault();
          return;
        }
      }

      // A sheet is the innermost thing open, so Escape puts that away first.
      if (event.key === "Escape" && sheet !== "none") {
        closeSheet();
        event.preventDefault();
        return;
      }

      // Not on a phone: there full screen is the layout rather than a mode, and Escape would be
      // leaving for a page that has nothing to show.
      if (event.key === "Escape" && expanded && !phone) {
        setExpanded(false);
        event.preventDefault();
        return;
      }

      // Ctrl/Cmd+Z brings back the last deleted room, or free wall. Deliberately NOT general undo:
      // these are the actions with no other way back, and pretending to more history than exists
      // would be worse.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (deletedRoom) {
          restoreRoom();
          event.preventDefault();
        } else if (deletedWall) {
          restoreWall();
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
      if (!selectedRoom) {
        if ((event.key === "Delete" || event.key === "Backspace") && selectedWall) {
          handleDeleteWall(selectedWall.id);
          event.preventDefault();
        }
        return;
      }

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
          handleRotateStairs(selectedRoom.id, event.key === "ArrowRight" ? 1 : -1);
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
  /**
   * Moves a room — and everything that is part of it: the rooms inside it, and any free wall
   * standing against it with whatever is joined to that wall. A bedroom carried off without its
   * closet, or out from under the partition drawn off its wall, is a drawing in two pieces that
   * then has to be lined up again by hand.
   *
   * Snapping is applied on every frame of the drag rather than only at the end, so the room
   * visibly latches onto its neighbours while it is being moved instead of jumping on release.
   * What moves with the room is left out of what it can snap to — a closet moving with its
   * bedroom is not a neighbour to line up with.
   */
  function handleMoveRoom(roomId: string, dx: number, dy: number) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const carried = new Set<string>([roomId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of sketch.rooms) {
        if (!carried.has(r.id) && r.parentRoomId && carried.has(r.parentRoomId)) {
          carried.add(r.id);
          grew = true;
        }
      }
    }
    const walls = freeWallsOf(sketch);
    const carriedWalls = new Set<string>();
    for (const id of carried) {
      const host = sketch.rooms.find((r) => r.id === id);
      if (host) for (const wallId of freeWallsAttachedToRoom(host, walls)) carriedWalls.add(wallId);
    }
    const snapped = snapRoomTranslation(
      sketch.rooms.filter((r) => r.id === roomId || !carried.has(r.id)),
      roomId,
      dx,
      dy,
      walls.filter((w) => !carriedWalls.has(w.id)),
    );
    onChange({
      ...sketch,
      rooms: withDerivedParents(sketch.rooms.map((r) => (carried.has(r.id) ? translate(r, snapped.dx, snapped.dy) : r))),
      freeWalls: walls.map((w) => (carriedWalls.has(w.id) ? translateFreeWall(w, snapped.dx, snapped.dy) : w)),
    });
  }

  /**
   * Moves a free wall and every wall joined to it end to end, then lands the lot flush with
   * whatever is nearest: a room corner or wall, or the end of another wall. See
   * `snapFreeWallTranslation`.
   */
  function handleMoveFreeWall(wallId: string, dx: number, dy: number) {
    const walls = freeWallsOf(sketch);
    const ids = connectedFreeWallIds(wallId, walls);
    const snapped = snapFreeWallTranslation(ids, walls, activeRooms, dx, dy, wallSnapRadiusPx(view.scale));
    onChange((prev) => ({ ...prev, freeWalls: freeWallsOf(prev).map((w) => (ids.includes(w.id) ? translateFreeWall(w, snapped.dx, snapped.dy) : w)) }));
  }

  /**
   * Moves a corner of a free wall, with every other wall end that shares it. On the last frame of
   * the drag the corner snaps — onto a room corner or wall, or the end of another wall — the same
   * way a tapped corner does.
   */
  function handleMoveFreeWallVertex(wallId: string, vertexId: string, x: number, y: number, done: boolean) {
    const walls = freeWallsOf(sketch);
    const wall = walls.find((w) => w.id === wallId);
    const vertex = wall?.vertices.find((v) => v.id === vertexId);
    if (!wall || !vertex) return;
    let target = { x, y };
    if (done) {
      // Nothing that shares the corner is a target for it, or it would snap to where it already is.
      const others = walls.filter((w) => !w.vertices.some((v) => Math.hypot(v.x - vertex.x, v.y - vertex.y) <= 0.5));
      const snapped = snapDraftPoint({ x, y }, { rooms: activeRooms, freeWalls: others, draft: [], radiusPx: wallSnapRadiusPx(view.scale) });
      target = { x: snapped.x, y: snapped.y };
    }
    onChange((prev) => ({ ...prev, freeWalls: moveSharedFreeWallVertex(freeWallsOf(prev), wallId, vertexId, target.x, target.y) }));
  }

  /**
   * Where a room of this size lands, and a pan to it if that is off screen — see lib/roomPlacement.ts.
   *
   * The selected room is the anchor when it is on this storey: a new room lands beside the one the
   * PM is working on. A room that has to land off screen is brought on screen, because a room that
   * appears where you cannot see it may as well not have appeared — the report was "I added a room
   * and it got lost".
   */
  function placeRoom(width: number, height: number): { x: number; y: number } {
    const anchor = selectedRoom && roomLevel(selectedRoom) === activeLevel ? selectedRoom : null;
    const viewport = { view, width: canvasWidth, height: canvasHeight };
    const spot = placeNewRoom({ rooms: activeRooms, anchor, width, height, gap: NEW_ROOM.gap, viewport });
    if (!spot.visible) setView(viewCentredOn({ x: spot.x, y: spot.y, width, height }, viewport));
    return { x: spot.x, y: spot.y };
  }

  /**
   * Turns a flight of stairs a quarter turn — the whole flight, see `rotateStairs`. Nesting is
   * re-derived because the footprint moves: a flight turned across a doorway may leave the room it
   * was in.
   */
  function handleRotateStairs(roomId: string, turns = 1) {
    onChange((prev) => ({ ...prev, rooms: withDerivedParents(prev.rooms.map((room) => (room.id === roomId ? rotateStairs(room, turns) : room))) }));
  }

  /**
   * A wall being pulled sideways, from where it stood when the drag began.
   *
   * The canvas reports each frame's increment; the room is rebuilt each frame from the wall as it
   * was and the whole travel so far, so a wall that runs into another room's wall can be reshaped
   * to follow it (`conformedDragWall`) — a shape that depends on how far out the wall has gone,
   * which frame-by-frame steps from an already reshaped room would compound.
   */
  const wallDrag = useRef<{ roomId: string; wallId: string; room: SketchRoom; obstacles: Obstacle[]; dx: number; dy: number; reshaped: boolean } | null>(null);
  function handleDragWall(roomId: string, wallId: string, dx: number, dy: number) {
    const current = wallDrag.current;
    if (!current || current.roomId !== roomId || current.wallId !== wallId) {
      const room = sketch.rooms.find((r) => r.id === roomId);
      if (!room) return;
      // What stands in the way is fixed at the start too: read frame by frame, a closet flush
      // inside the room stopped being "inside" the moment one frame went inward, and from then on
      // stood in the way of every frame outward.
      wallDrag.current = { roomId, wallId, room, obstacles: obstaclesFor(sketch, activeLevel, { roomId }), dx: 0, dy: 0, reshaped: false };
    }
    const drag = wallDrag.current as { roomId: string; wallId: string; room: SketchRoom; obstacles: Obstacle[]; dx: number; dy: number; reshaped: boolean };
    drag.dx += dx;
    drag.dy += dy;
    drag.reshaped = wallDragMeetsWall(drag.room, wallId, drag.dx, drag.dy, drag.obstacles);
    const reshaped = conformedDragWall(drag.room, wallId, drag.dx, drag.dy, drag.obstacles);
    updateRoom(roomId, () => reshaped);
  }

  /**
   * The next room over, pulled off a wall of this one — see `pullRoomFromWall`. It lands selected
   * and numbered ("Room 3"), like any new room, with the tool put away: the next press is for
   * naming it or dragging its far wall, not for pulling another.
   */
  function handlePullRoom(roomId: string, wallId: string, depthPx: number) {
    const source = sketch.rooms.find((r) => r.id === roomId);
    // Everything else on the storey is in the way, including the rest of the source room — only
    // the wall being pulled from is not, being where the new room begins. A negative depth is a
    // pull INTO the room: a closet off that wall, for which the room's own closets are in the way.
    const inward = depthPx < 0;
    const around = { obstacles: obstaclesFor(sketch, activeLevel, { wall: { roomId, wallId }, inward }), rooms: sketch.rooms };
    const room = source ? pullRoomFromWall(source, wallId, depthPx, around) : null;
    if (!room) {
      setWallNotice(inward ? "Nothing fits inside that wall — there is a closet there already." : "Nothing fits in front of that wall — there is a room there already.");
      return;
    }
    setWallNotice(null);
    setTool("select");
    onChange((prev) => ({ ...prev, rooms: withDerivedParents([...prev.rooms, room]) }));
    setSelectedRoomId(room.id);
    setSelectedSymbolId(null);
    setSelectedWallId(null);
  }

  function handleAddRoom() {
    const { x, y } = placeRoom(NEW_ROOM.width, NEW_ROOM.height);
    // A rectangle is just the four-vertex case; every new room starts as one.
    const room: SketchRoom = {
      id: newSketchId("room"),
      name: nextRoomName(sketch.rooms),
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
    setNewReadingId(null);
    setUnderlayTouched(false);
  }

  function handleAddStairs() {
    const { x, y } = placeRoom(STAIRS_DEFAULT.runFeet * PIXELS_PER_FOOT, STAIRS_DEFAULT.widthFeet * PIXELS_PER_FOOT);
    // Stairs are a room (see `StairsData`), so they join the storey being drawn like any other.
    const room = { ...newStairRoom(x, y), level: activeLevel };
    onChange({ ...sketch, rooms: withDerivedParents([...sketch.rooms, room]) });
    setSelectedRoomId(room.id);
    setSelectedSymbolId(null);
    setTool("select");
  }

  /**
   * Draws the closet behind one door — see `closetBehindDoor` for the geometry and the defaults.
   *
   * Unlike the other adds it does not go through `placeRoom`: the closet's place is fixed by
   * the door, against the far side of that wall, and it is selected on arrival so the PM can drag
   * or type its walls to fit while the door is still in view. Nothing is drawn unless this is
   * called, and it is only ever called from a button.
   */
  function handleAddCloset(roomId: string, doorId: string) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const closet = closetBehindDoor(room, doorId);
    if (!closet) return;
    // `withDerivedParents` so a closet that lands inside another room is a sub-room at once.
    onChange((prev) => ({ ...prev, rooms: withDerivedParents([...prev.rooms, closet]) }));
    setSelectedRoomId(closet.id);
    setSelectedSymbolId(null);
    setTool("select");
  }

  /**
   * Brings in a room the phone measured — see `lib/scanImport.ts` for the file and the mapping.
   *
   * It lands like any other new room: on the storey being drawn, clear of the rooms already there,
   * selected and ready to be named. The scan knows the room's size and where its door is; it does
   * not know what the room is called or where it sits in the house, and both stay the PM's job.
   *
   * Doors tapped as closet doors are reported, not acted on: the notice offers to draw a closet
   * behind each, and the PM takes the offer or dismisses it. The closets are built from the room
   * as it stands when the button is pressed — from the sketch state, not the import result — so a
   * room dragged into place first gets its closets where it now is, not where it landed. A door
   * the PM has meanwhile drawn a closet behind by hand (`closetExistsBehind`) is left alone: the
   * offer is "add the closets", not "add them again".
   *
   * Stairs are different: a flight the phone tapped comes in as a room of its own (`extraRooms`),
   * and it is added WITH the room, in the same update, not offered. A closet is a guess at what is
   * behind a door; a flight is four corners the PM stood at and tapped, in the same frame as the
   * room's own, and it belongs on the sketch as surely as the room does. One update rather than
   * two so `withDerivedParents` sees the flight and the room together and nests the one in the
   * other at once, and the sketch never holds a flight without its room. Selection stays on the
   * room: it is the one the PM will name and drag into place, and the flight follows as its child.
   *
   * A CAPTURE — several rooms tapped in one session, in one file — arrives the same way: the first
   * room as `room`, the others in `extraRooms` beside the flights, every one in the frame they
   * were tapped in, so the hall lands against the family room's wall as it stands in the house.
   * The same one update adds them all, and `withDerivedParents` finds no room inside another and
   * leaves them neighbours. Selection is the first room, as the PM tapped it first; the whole
   * capture is dragged into place from any of its rooms, one at a time, since the rooms are
   * neighbours and not a group — the point of the frame is that they need no dragging against each
   * other, only against the house. The importer's own first note says how many rooms came in and
   * that they were placed as tapped, so it leads the notice; "Room imported." is for the one-room
   * file, where the importer has no such sentence. Which is which is the result's `kind`, not a
   * count of what came in: a capture whose second room the phone wrote short comes in as one room
   * and still says "1 room imported, placed as tapped.", and "Room imported." in front of that
   * would be the same news twice.
   */
  async function handleImportScan(file: File) {
    const text = await file.text();
    // Where exactly it lands is the PM's to fix, in view; how much room it needs is the file's to
    // say. A capture is two or three rooms wide, and a spot clear for one room's default size would
    // have its hall and bathroom lapping the room already on the page to the right — and a small
    // room landing wholly inside one is nested into it. The importer takes the drop point before it
    // parses, so the size is asked for first (`scanExtentPx`); a file that will not parse falls
    // back to a room's size and the import that follows says what was wrong with it.
    const extent = scanExtentPx(text) ?? { width: NEW_ROOM.width, height: NEW_ROOM.height };
    const { x, y } = placeRoom(extent.width, extent.height);
    const result = importScanRoom(text, { x, y }, activeLevel);
    if (!result.ok) {
      setImportNotice({ kind: "error", text: result.error });
      return;
    }
    onChange((prev) => ({ ...prev, rooms: withDerivedParents([...prev.rooms, result.room, ...result.extraRooms]) }));
    setSelectedRoomId(result.room.id);
    setSelectedSymbolId(null);
    setTool("select");

    const roomId = result.room.id;
    const closetDoorIds = result.closetDoorIds;
    const closetCount = closetDoorIds.length;
    // A capture's first note is already its lead — the count — so only the one-room file gets one
    // from here. By the file's shape, not by counting rooms in the result: see the doc above.
    const parts = result.kind === "capture" ? [...result.notes] : ["Room imported.", ...result.notes];
    if (closetCount > 0) {
      parts.push(closetCount === 1 ? "1 closet door tapped — add a closet behind it?" : `${closetCount} closet doors tapped — add a closet behind each?`);
    }
    // One room with nothing to say about it needs no notice; a capture always has its count to say,
    // since which rooms came in and where is the news.
    if (result.kind === "room" && parts.length === 1) {
      setImportNotice(null);
      return;
    }
    setImportNotice({
      kind: "note",
      text: parts.join(" "),
      action:
        closetCount > 0
          ? {
              label: "Add closets",
              run: () => {
                onChange((prev) => {
                  // The room may have been deleted, or a door removed, since the notice went up;
                  // whatever is still there gets its closet and the rest is quietly nothing. A door
                  // that already has its closet — drawn by hand while the notice was up, or added
                  // a moment ago by an earlier door in this same batch — is skipped rather than
                  // doubled. The batch case is real: two closet doors tapped on one chamfer both
                  // want the same corner, since the corner has one shape whatever the door's
                  // position, so each door is checked against the closets added before it.
                  const room = prev.rooms.find((r) => r.id === roomId);
                  if (!room) return prev;
                  const closets: SketchRoom[] = [];
                  for (const doorId of closetDoorIds) {
                    if (closetExistsBehind([...prev.rooms, ...closets], room, doorId)) continue;
                    const closet = closetBehindDoor(room, doorId);
                    if (closet) closets.push(closet);
                  }
                  return closets.length === 0 ? prev : { ...prev, rooms: withDerivedParents([...prev.rooms, ...closets]) };
                });
                // The imported room, not a closet: with several closets there is no one to pick,
                // and the room is where the PM was looking.
                setSelectedRoomId(roomId);
                setSelectedSymbolId(null);
                setTool("select");
                setImportNotice(null);
              },
            }
          : undefined,
    });
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
    // Re-derived so a sub-room of the deleted room does not keep pointing at it; a chosen parent
    // is only set aside (`validChosenParent`), and comes back with the room if this is undone.
    onChange((prev) => ({ ...prev, rooms: withDerivedParents(prev.rooms.filter((r) => r.id !== roomId)) }));
    if (selectedRoomId === roomId) {
      setSelectedRoomId(null);
      setSelectedSymbolId(null);
    }
  }

  /** Puts the last deleted room back where it was, readings and all. */
  /**
   * Squares the leaning corners of [roomId] — see `lib/sketchSquare.ts` for what that means.
   *
   * The whole room at once rather than a corner at a time, because squaring one often squares its
   * neighbour for free (the kitchen's jog did), and because picking a corner on a phone is fiddly
   * when the fix is "make this room the shape it obviously is".
   */
  function handleSquareUp(roomId: string) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const before = room.vertices;
    const result = squareUpRoom(room);
    if (result.moved.length === 0) return;
    updateRoom(roomId, () => result.room);
    setSquared({ roomId, vertices: before, count: result.moved.length });
  }

  function restoreSquared() {
    if (!squared) return;
    const { roomId, vertices } = squared;
    setSquared(null);
    updateRoom(roomId, (room) => ({ ...room, vertices }));
  }

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

  /*
    ── The wall tool ─────────────────────────────────────────────────────────────────────────────
    The canvas snaps each tap and hands it here; `addDraftPoint` says whether it extended the run or
    closed it into a room. A room lands like any other new room — selected, on this storey, ready to
    be named — and any free walls it was closed through are used up by it. Done keeps an open run as
    a free wall. Either way the tool puts itself away afterwards, as the symbol tools do: a tool that
    stays out turns the next tap meant for selecting into another corner.
  */
  function handleWallTap(point: DraftPoint) {
    const step = addDraftPoint(wallDraft, point, sketch, activeLevel, wallSnapRadiusPx(view.scale));
    if (step.kind === "ignore") {
      // The last corner tapped again — or double-tapped, which is the same two taps — keeps the run.
      if (step.reason === "last" && wallDraft.length >= 2) finishWallDraft();
      if (step.reason === "covered") setWallNotice("That is already a wall. Tap past its end to carry on from it.");
      return;
    }
    setWallNotice(null);
    if (step.kind === "extend") {
      setWallDraft(step.draft);
      return;
    }
    const used = step.usedFreeWallIds;
    onChange((prev) => ({
      ...prev,
      rooms: withDerivedParents([...prev.rooms, step.room]),
      freeWalls: freeWallsOf(prev).filter((w) => !used.includes(w.id)),
    }));
    setWallDraft([]);
    setSelectedWallId(null);
    setSelectedRoomId(step.room.id);
    setSelectedSymbolId(null);
    setTool("select");
  }

  function finishWallDraft() {
    const finished = finishDraft(wallDraft, activeLevel, freeWallsOf(sketch));
    setWallDraft([]);
    setTool("select");
    if (!finished) return;
    onChange((prev) => ({ ...prev, freeWalls: finished.freeWalls }));
    setSelectedRoomId(null);
    setSelectedSymbolId(null);
    // One wall at a time holds the panel; the last piece drawn is the one the PM is looking at.
    setSelectedWallId(finished.selectIds[finished.selectIds.length - 1] ?? null);
  }

  function cancelWallDraft() {
    setWallDraft([]);
    setTool("select");
  }

  function updateFreeWall(wallId: string, update: (wall: FreeWall) => FreeWall) {
    onChange((prev) => ({ ...prev, freeWalls: freeWallsOf(prev).map((w) => (w.id === wallId ? update(w) : w)) }));
  }

  /** Deletes a free wall, keeping it aside so the delete can be taken back — as `handleDeleteRoom`. */
  function handleDeleteWall(wallId: string) {
    const walls = freeWallsOf(sketch);
    const index = walls.findIndex((w) => w.id === wallId);
    const wall = walls[index];
    if (!wall) return;
    setDeletedWall({ wall, index });
    onChange((prev) => ({ ...prev, freeWalls: freeWallsOf(prev).filter((w) => w.id !== wallId) }));
    if (selectedWallId === wallId) setSelectedWallId(null);
  }

  function restoreWall() {
    if (!deletedWall) return;
    onChange((prev) => {
      const walls = [...freeWallsOf(prev)];
      walls.splice(Math.min(deletedWall.index, walls.length), 0, deletedWall.wall);
      return { ...prev, freeWalls: walls };
    });
    setSelectedWallId(deletedWall.wall.id);
    setDeletedWall(null);
  }

  function handleTapFreeWallSegment(wallId: string, vertexId: string, screen: { x: number; y: number }) {
    const wall = freeWallsOf(sketch).find((w) => w.id === wallId);
    const segment = wall ? freeWallSegments(wall).find((piece) => piece.id === vertexId) : null;
    setLengthDraft(segment ? formatFeetInches(segment.lengthFeet) : "");
    setLengthError(null);
    setPendingLength({ kind: "freeWall", wallId, vertexId, screen });
  }

  /*
    A wall drawn on one storey stays there. Switching storey or mode mid-run would leave corners on
    a floor that is no longer showing, so the run is dropped rather than carried; likewise when the
    tool is put away for another.
  */
  useEffect(() => {
    setWallDraft([]);
    setWallNotice(null);
  }, [tool, mode, activeLevel]);

  function handleTapWall(roomId: string, wallId: string, screen: { x: number; y: number }, run: [number, number]) {
    const room = sketch.rooms.find((r) => r.id === roomId);
    const wall = room ? wallById(room, wallId) : null;
    // Pre-fill with the current length — of the stretch tapped, matching its label — so correcting a
    // typo doesn't mean retyping from scratch.
    const existing = wall ? wallRunFeet(wall, run) : null;
    setLengthDraft(existing == null ? "" : formatFeetInches(existing));
    setLengthError(null);
    setPendingLength({ kind: "room", roomId, wallId, screen, run });
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
   *
   * The figure typed is for the stretch that was tapped — beside a closet, the wall short of the
   * closet — so the whole wall is expected to come out longer by the closet's share.
   */
  function handleSubmitLength() {
    if (!pendingLength) return;
    const feet = parseFeetInches(lengthDraft);
    if (feet == null || feet <= 0) {
      setLengthError('Enter a length like 12\'6" or 12.5');
      return;
    }

    // A piece of free wall: its far corner slides along it. Nothing else has to give, so nothing
    // is checked but the minimum — see `withFreeWallSegmentLength`.
    if (pendingLength.kind === "freeWall") {
      const { wallId, vertexId } = pendingLength;
      const wall = freeWallsOf(sketch).find((w) => w.id === wallId);
      const resized = wall ? withFreeWallSegmentLength(wall, vertexId, feet) : null;
      if (!wall || !resized || resized === wall) {
        setLengthError("Too short to draw. A piece of wall is at least 6\".");
        return;
      }
      updateFreeWall(wallId, () => resized);
      setPendingLength(null);
      setLengthDraft("");
      return;
    }

    const room = sketch.rooms.find((r) => r.id === pendingLength.roomId);
    const wall = room ? wallById(room, pendingLength.wallId) : null;
    if (!room || !wall) return;
    const expected = feet + wall.lengthFeet - wallRunFeet(wall, pendingLength.run);
    const resized = withWallRunLength(room, pendingLength.wallId, pendingLength.run, feet);
    const got = wallById(resized, pendingLength.wallId)?.lengthFeet;
    // Half an inch of tolerance: the reshape is exact, but the round trip through pixels is not.
    if (got == null || Math.abs(got - expected) > 1 / 24) {
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

  function handlePlaceSymbol(roomId: string, wallId: string, t: number, widthPx?: number) {
    // Islands are placed on open floor, and a break isn't a symbol at all — both are handled
    // elsewhere and must not fall through to symbol placement.
    if (tool === "select" || tool === "island" || tool === "break") return;
    const room = sketch.rooms.find((r) => r.id === roomId);
    if (!room) return;
    // An opening is a door without a leaf — see `ToolMode`.
    const created = newSymbol(tool === "opening" ? "door" : (tool as SymbolType), wallId, t, room);
    // A fixture is created generic then specialised, so it arrives at its own standard footprint
    // rather than a toilet's.
    const shaped =
      created.type === "fixture"
        ? withFixtureType(created, room, pendingFixture)
        : tool === "opening" && created.type === "door"
          ? { ...created, doorType: "opening" as const }
          : created;
    // Drawn as wide as the finger was dragged along the wall, when it was — see the canvas.
    const symbol = widthPx == null ? shaped : withSymbolWidthPx(shaped, room, widthPx, sketch.rooms, freeWallsOf(sketch));
    updateRoom(roomId, (r) => ({ ...r, symbols: [...r.symbols, symbol] }));
    setSelectedRoomId(roomId);
    setSelectedSymbolId(symbol.id);
    // Back to select after each placement — a sticky tool means the next tap meant for measuring
    // silently drops another door instead.
    setTool("select");
  }

  const summary = sketchSummaryText(sketch);
  const zoomPercent = Math.round(view.scale * 100);

  /** The sentence under the toolbar, or above the bar on a phone: what a tap does right now. */
  const hintText =
        mode === "moisture"
          ? moistureTool === "read"
            ? "Tap a wall to record a reading there. Drag either end of a mark to cover only the wet run."
            : `${moistureTool === "erase" ? "Drag to erase" : "Drag to highlight"} the affected ${paintSurface}. Pinch to zoom.`
          : tool === "wall"
            ? wallNotice
              ? wallNotice
              : wallDraft.length === 0
              ? "Tap where the wall starts. Taps snap to corners and to other walls."
              : "Tap the next corner. Tap the first corner again to close a room; tap the last corner again, or Done, to keep the walls as drawn."
          : sketch.rooms.length === 0
          ? "Add a room, or tap Wall and draw one corner by corner."
          : tool === "select"
            ? "Tap to select, drag to move. Double-tap a wall or its measurement to type its length; double-tap a CORNER to remove it and join the two walls. For an L: tap Break, tap a wall, then drag one half out. Drag empty space to pan; pinch to zoom."
            : tool === "pull"
              ? wallNotice ?? "Drag out from a wall to pull the next room off it, or in for a closet inside — same wall, same doors. A tap pulls a 12' room out."
            : tool === "island"
              ? "Tap open floor inside the room to drop a free-standing cabinet."
              : tool === "break"
                ? "Tap a wall where you want a new corner, then drag that corner or either half of the wall to shape it."
                : tool === "fixture"
                  ? `Tap the wall where the ${FIXTURE_LABEL[pendingFixture].toLowerCase()} goes.`
                  : tool === "opening"
                    ? "Tap the wall where the opening goes, or press and drag along the wall to draw it as wide as you want."
                    : tool === "door" || tool === "window"
                      ? `Tap the wall where the ${SYMBOL_LABEL[tool].toLowerCase()} goes, or press and drag along the wall to draw it as wide as you want.`
                      : `Tap the wall where the ${SYMBOL_LABEL[tool as SymbolType].toLowerCase()} goes.`;

  /**
   * Puts a sheet away and hands focus back to the bar.
   *
   * Without the focus, closing a sheet with the keyboard drops focus to the document body and the
   * next Tab walks into the claim page behind a full-screen card nobody can see through.
   */
  function closeSheet() {
    setSheet("none");
    moreButtonRef.current?.focus();
  }

  /** Zoom, with Reset only where there is room for it. */
  function zoomControls(withReset: boolean) {
    return (
      <div className="sketch-zoom">
        <button type="button" className="btn-secondary" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale / 1.2) }))}>
          −
        </button>
        <span className="sketch-zoom-level">{zoomPercent}%</span>
        <button type="button" className="btn-secondary" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale * 1.2) }))}>
          +
        </button>
        {withReset && (
          <button type="button" className="btn-secondary" onClick={() => setView(fitToLevel())}>
            Reset
          </button>
        )}
      </div>
    );
  }

  /** The storeys, and what is traced under the one being drawn. Above the tools on the desktop,
      in the More sheet on a phone — in both cases framing everything else rather than sitting
      among the things you place. The order is physical, lowest at the left. */
  const levelStrip = (!readOnly || levels.length > 1) && (
      <div className="sketch-levels" role="toolbar" aria-label="Levels">
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={() => handleAddLevel(-1)} title="Add a storey below the lowest one">
            + Level below
          </button>
        )}
        <div className="option-group" role="group" aria-label="Level being shown">
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
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={() => handleAddLevel(1)} title="Add a storey above the highest one">
            + Level above
          </button>
        )}
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
  );

  /*
    Every tool as a node under its name — see `lib/sketchTouch.ts` for why the names are a list
    of their own. The desktop row and the phone's bar and sheet all draw from this one map, so a
    tool cannot be worded one way in one place and another way in the other.
  */
  const noRooms = sketch.rooms.length === 0;
  const placementNode = (key: SketchToolKey, label: string) => (
    <button
      key={key}
      type="button"
      className={`option-btn${tool === key ? " selected" : ""}`}
      aria-pressed={tool === key}
      disabled={noRooms && key !== "wall"}
      onClick={() => setTool(tool === key ? "select" : (key as ToolMode))}
    >
      {label}
    </button>
  );
  const toolNodes: Record<SketchToolKey, ReactNode> = {
    /* Phone only. On the desktop a tool toggles back to selecting, and a button for the thing
       that happens by itself would be a fourteenth button. On a bar of three it is the way back
       from a tool, and it has to be visible. */
    select: (
      <button
        key="select"
        type="button"
        className={`option-btn${tool === "select" ? " selected" : ""}`}
        aria-pressed={tool === "select"}
        onClick={() => setTool("select")}
      >
        Select
      </button>
    ),
    room: (
      <button key="room" type="button" className="btn-secondary" onClick={handleAddRoom}>
        + Add room
      </button>
    ),
    /* Stairs are a room, not a fitting — see `StairsData`. Added the same way one is. */
    stairs: (
      <button key="stairs" type="button" className="btn-secondary" onClick={handleAddStairs}>
        + Add stairs
      </button>
    ),
    /* A room measured by the phone scanner, from the JSON it saves next to its point cloud. */
    scan: (
      <button key="scan" type="button" className="btn-secondary" onClick={() => scanFileRef.current?.click()}>
        Import scan
      </button>
    ),
    /* Walls a corner at a time: a partition into a room, or a room of any shape from scratch.
       The one tool that works on an empty sketch, since it is a way to start one. */
    wall: placementNode("wall", "Wall"),
    /* The next room over, off a wall of this one — same wall, same doors. */
    pull: placementNode("pull", "Pull room"),
    break: placementNode("break", "Break"),
    door: placementNode("door", "Door"),
    /* A missing wall or a cased opening: the same hole in a wall, described by width and head
       height rather than by a leaf. */
    opening: placementNode("opening", "Opening"),
    window: placementNode("window", "Window"),
    cabinet: placementNode("cabinet", "Cabinet"),
    island: placementNode("island", "Island"),
    /* Picking a fixture arms the tool in the same action — two steps for one intent would just
       be a way to have the wrong fixture selected. */
    fixture: (
      <select
        key="fixture"
        className={`sketch-fixture-select${tool === "fixture" ? " selected" : ""}`}
        aria-label="Fixture to place"
        value={tool === "fixture" ? pendingFixture : ""}
        disabled={noRooms}
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
    ),
    sizes: (
      <button
        key="sizes"
        type="button"
        className={`option-btn${showSizes ? " selected" : ""}`}
        aria-pressed={showSizes}
        onClick={() => setShowSizes((v) => !v)}
      >
        Sizes
      </button>
    ),
  };

  const brushInHand = moistureTool === "paint" || moistureTool === "erase";
  const moistureNode = (key: "read" | "paint" | "erase", label: string) => (
    <button
      key={key}
      type="button"
      className={`option-btn${moistureTool === key ? " selected" : ""}`}
      aria-pressed={moistureTool === key}
      onClick={() => setMoistureTool(key)}
    >
      {label}
    </button>
  );
  const surfaceNode = (key: "floor" | "ceiling", label: string) => (
    <button
      key={key}
      type="button"
      className={`option-btn${paintSurface === key ? " selected" : ""}`}
      aria-pressed={paintSurface === key}
      onClick={() => setPaintSurface(key)}
    >
      {label}
    </button>
  );
  const moistureNodes: Record<MoistureToolKey, ReactNode> = {
    read: moistureNode("read", "Wall reading"),
    paint: moistureNode("paint", "Highlight"),
    erase: moistureNode("erase", "Erase"),
    floor: surfaceNode("floor", "Floor"),
    ceiling: surfaceNode("ceiling", "Ceiling"),
    /* The clean sketch is one toggle away, because it is the same drawing without this layer. */
    showMoisture: (
      <button
        key="showMoisture"
        type="button"
        className={`option-btn${showMoisture ? " selected" : ""}`}
        aria-pressed={showMoisture}
        onClick={() => setShowMoisture((v) => !v)}
      >
        Show moisture
      </button>
    ),
  };

  return (
    <div className={`card sketch-card${expanded ? " sketch-card-expanded" : ""}${phone ? " sketch-card-phone" : ""}`}>
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
        {/* A phone is already full screen and has no page to go back to, so the control that
            would only ever say "Exit" is not shown there. */}
        {!phone && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Back to the page (Esc)" : "Give the sketch the whole screen"}
          >
            {expanded ? "Exit full screen" : "Full screen"}
          </button>
        )}
        {/*
          The way out, and it looks like it.

          It was a secondary button in a row of secondary buttons, which on a phone stacks into a
          column where nothing says which one ends the task — reported as getting lost. It is the
          primary action of this screen once the drawing is done, so it is styled as one.

          Still hidden in full screen: Exit full screen is the way back from there, and it sits right
          beside this.
        */}
        {/* Always there on a phone: it is the only way back, since full screen is not a mode. */}
        {(!expanded || phone) && (
          <button className="btn-primary sketch-done" onClick={onClose}>
            {/* The phone says it in one word: the header is a single row there and the sentence
                would take half of it. */}
            {phone ? "Done" : "Done — back to claim"}
          </button>
        )}
      </div>

      {/*
        The storeys, and what is traced under the one being drawn.

        Above the tools rather than among them: which floor you are on frames everything else in the
        toolbar, and a level control sitting between Door and Window would read as another thing to
        place. The order is physical — lowest at the left, highest at the right — so the row matches
        the building rather than the order the levels were added in.

        Shown in every mode, viewing included. It sat with the drawing tools, so View only — the
        door most looks come through — had no way onto another storey: a basement-only claim
        opened as an empty main level with a dashed trace underneath and nothing to press. Which
        storey you are looking at is a view choice, not an edit, and so is what is shown under it;
        only adding a storey is an edit, and only that is held back while locked. Hidden while
        locked on a single-storey sketch, where one button that is already pressed says nothing.
      */}
      {!phone && levelStrip}

      {/* The desktop toolbars. A phone gets the same nodes on its bottom bar and in More. */}
      {!phone && !readOnly && (mode === "moisture" ? (
        <div className="sketch-toolbar" role="toolbar" aria-label="Moisture tools">
          <div className="option-group" role="group" aria-label="Moisture tool">
            {(["read", "paint", "erase"] as MoistureToolKey[]).map((key) => moistureNodes[key])}
          </div>
          {/*
            Which surface the brush paints — shown only with a brush in hand.

            These were briefly always visible, to make the ceiling discoverable. That traded one
            problem for a worse one: with no brush selected they are buttons that visibly do nothing,
            which reads as broken rather than as inapplicable. Discoverability is handled instead by
            the tool being called "Highlight" rather than "Highlight floor" — pressing it and then
            being asked which surface is a sequence that explains itself.
          */}
          {brushInHand && (
            <div className="option-group" role="group" aria-label="Surface to highlight">
              {(["floor", "ceiling"] as MoistureToolKey[]).map((key) => moistureNodes[key])}
            </div>
          )}
          {moistureNodes.showMoisture}
          {zoomControls(false)}
        </div>
      ) : (
        <div className="sketch-toolbar" role="toolbar" aria-label="Sketch tools">
          {SKETCH_DESKTOP_LEADING.map((key) => toolNodes[key])}
          <div className="option-group" role="group" aria-label="Placement tool">
            {SKETCH_PLACEMENT_KEYS.map((key) => toolNodes[key])}
          </div>
          {SKETCH_DESKTOP_TRAILING.map((key) => toolNodes[key])}
          {zoomControls(true)}
        </div>
      ))}

      {/* Mounted outside the toolbars: Import scan lives on the bar on a phone and in the desktop
          row otherwise, and the input it opens must exist wherever the button is. */}
      <input
        ref={scanFileRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Room scan file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so choosing the same file again still fires a change.
          e.target.value = "";
          if (file) void handleImportScan(file);
        }}
      />

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
      {squared && !deletedRoom && (
        <div className="sketch-undo" role="status">
          <span>
            {squared.count} corner{squared.count === 1 ? "" : "s"} squared.
          </span>
          <button type="button" className="btn-secondary" onClick={restoreSquared}>
            Undo
          </button>
        </div>
      )}
      {deletedWall && !deletedRoom && (
        <div className="sketch-undo" role="status">
          <span>Wall deleted.</span>
          <button type="button" className="btn-secondary" onClick={restoreWall}>
            Undo
          </button>
        </div>
      )}
      {notice}
      {importNotice && (
        <div className="sketch-undo" role={importNotice.kind === "error" ? "alert" : "status"}>
          <span>{importNotice.text}</span>
          {/* The offer comes before OK, as Undo does: the thing to do, then the way out. */}
          {importNotice.action && (
            <button type="button" className="btn-secondary" onClick={importNotice.action.run}>
              {importNotice.action.label}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setImportNotice(null)}>
            OK
          </button>
        </div>
      )}

      {/* The hint follows the MODE first: the sketching instructions describe gestures that are
          switched off while mapping, so leaving them up told the PM to do impossible things. */}
      {/* On a phone this is the one line above the bar — see `sketch-bar-line` below. */}
      {!phone && <p className="field-note sketch-hint">{hintText}</p>}

      <div
        className={`sketch-canvas-wrap${readOnly ? " sketch-canvas-readonly" : ""}`}
        ref={containerRef}
        /* Capture, so the finger is on record before Konva's own handlers select anything. */
        onPointerDownCapture={(e) => {
          pointerOnPlan.current = { x: e.clientX, y: e.clientY };
          detailsWaiting.current = false;
        }}
        onPointerUp={(e) => {
          const from = pointerOnPlan.current;
          pointerOnPlan.current = null;
          const waiting = detailsWaiting.current;
          detailsWaiting.current = false;
          if (!phone) return;
          // A tap, not a drag: a move is a placement or a nudge, and its properties can wait for
          // the estimator to ask for them.
          const still = from !== null && Math.hypot(e.clientX - from.x, e.clientY - from.y) <= TAP_SLOP_PX;
          if (!still) return;
          /*
            `waiting` is the tap that CHANGED the selection — the effect above saw the finger down
            and left it here. A tap on something ALREADY selected changes no state and so reaches no
            effect, and it used to raise the sheet too, so that a wall whose length box had been
            closed could be re-opened by tapping it again.

            For a WALL or a SYMBOL that is right: the sheet is the thing you came for, the length
            box lives in it, and tapping the wall again is how you get it back.

            For a ROOM it is not, and the estimator of 2026-09-24 spent an afternoon on it: every
            attempt to grab a wall that landed a few pixels wide of it selected the room instead,
            and the room's name, sub-room and ceiling slid up over the very drawing they were
            aiming at. Close, aim, miss, close again. A room's properties are one tap away on the
            bar - the button is right there - and that is the right price for a tap that was
            probably aimed at something else.
          */
          const reopen = selectionKey !== null && !selectionKey.startsWith("room:");
          if (waiting || reopen) setSheet("details");
        }}
        onPointerCancel={() => {
          pointerOnPlan.current = null;
          detailsWaiting.current = false;
        }}
      >
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
          onSelectRoom={(roomId) => {
            setSelectedRoomId(roomId);
            // One selection at a time: a room and a free wall cannot both hold the panel.
            if (roomId !== null) setSelectedWallId(null);
          }}
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
          onDragWall={handleDragWall}
          onDragWallEnd={(roomId, wallId) => {
            // A wall placed by the walls it ran into stays put; only a freehand wall is snapped to
            // the room's own corners — see `wallDragMeetsWall`.
            const reshaped = wallDrag.current?.reshaped ?? false;
            wallDrag.current = null;
            if (!reshaped) updateRoom(roomId, (room) => snapWallToNeighbours(room, wallId));
          }}
          onMoveVertex={(roomId, vertexId, x, y) => updateRoom(roomId, (room) => moveVertex(room, vertexId, x, y))}
          onRemoveVertex={(roomId, vertexId) => updateRoom(roomId, (room) => removeVertex(room, vertexId))}
          onMoveSymbol={(roomId, symbolId, centrePx) =>
            /*
              `sketch.rooms` is passed so a cabinet knows which sub-rooms stand on its wall — a
              closet inside a bedroom takes its share of that wall, and a run of cabinets stops
              where it begins rather than carrying on underneath it. See `blockRunPx`.
            */
            updateSymbol(roomId, symbolId, (symbol, room) => moveSymbolAlongWall(symbol, room, centrePx, sketch.rooms, freeWallsOf(sketch)))
          }
          onResizeSymbol={(roomId, symbolId, centrePx, widthPx) =>
            updateSymbol(roomId, symbolId, (symbol, room) =>
              moveSymbolAlongWall(withSymbolWidthPx(symbol, room, widthPx, sketch.rooms, freeWallsOf(sketch)), room, centrePx, sketch.rooms, freeWallsOf(sketch)),
            )
          }
          freeWalls={activeFreeWalls}
          selectedWallId={selectedWallId}
          wallDraft={tool === "wall" ? wallDraft : undefined}
          onWallTap={handleWallTap}
          onSelectWall={(wallId) => {
            setSelectedWallId(wallId);
            if (wallId !== null) {
              setSelectedRoomId(null);
              setSelectedSymbolId(null);
            }
          }}
          onMoveFreeWall={handleMoveFreeWall}
          onMoveFreeWallVertex={handleMoveFreeWallVertex}
          onTapFreeWallSegment={handleTapFreeWallSegment}
          onPullRoom={handlePullRoom}
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
        {tool === "wall" && wallDraft.length > 0 && (
          <div className="sketch-direction" role="group" aria-label="Wall being drawn">
            <button type="button" className="btn-secondary" onClick={() => setWallDraft((d) => d.slice(0, -1))} title="Take back the last corner">
              Undo corner
            </button>
            <button type="button" className="btn-secondary" onClick={cancelWallDraft}>
              Cancel
            </button>
            {/* The one primary action on the canvas while drawing — see the amber rule in globals.css. */}
            <button type="button" className="btn-primary" onClick={finishWallDraft} disabled={wallDraft.length < 2} title="Keep the walls as drawn (Enter)">
              Done
            </button>
          </div>
        )}

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
          onRotateStairs={() => selectedRoom && handleRotateStairs(selectedRoom.id)}
          onDoorType={(doorType) =>
            selectedRoom &&
            selectedSymbol &&
            updateSymbol(selectedRoom.id, selectedSymbol.id, (symbol) => (symbol.type === "door" ? { ...symbol, doorType } : symbol))
          }
          onFlipStairs={() =>
            selectedRoom &&
            updateRoom(selectedRoom.id, (room) =>
              room.stairs ? { ...room, stairs: { ...room.stairs, direction: room.stairs.direction === "up" ? "down" : "up" } } : room,
            )
          }
        />
      </div>
      </div>

      {/*
        The properties: a column beside the plan on the desktop, a sheet that rises over it on a
        phone. Same DOM either way — a panel that had to be rebuilt for the small screen would be
        two panels to keep in step, and the one nobody is looking at is the one that rots.
      */}
      <div
        className={`sketch-side${phone ? ` sketch-sheet${sheet === "details" ? " sketch-sheet-open" : ""}` : ""}`}
        aria-hidden={phone && sheet !== "details"}
      >
      {phone && (
        <div className="sketch-sheet-head">
          <span className="sketch-sheet-grip" aria-hidden="true" />
          <button type="button" className="btn-secondary" onClick={closeSheet}>
            Close
          </button>
        </div>
      )}

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
            Whether the name is drawn on the plan — see `labelHidden`. Directly under the name,
            because it is about the name. Stored as the hidden case so a sketch saved before the
            field existed reads as shown without being rewritten; nothing here ever writes undefined.
          */}
          <div className="question">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={labelShown(selectedRoom)}
                onChange={(e) => updateRoom(selectedRoom.id, (room) => ({ ...room, labelHidden: !e.target.checked }))}
              />
              Show name on sketch
            </label>
            {!labelShown(selectedRoom) && (
              <p className="field-note">Hidden on the drawing only. The room keeps its name in the scope, and a double-tap where the name was still renames it.</p>
            )}
          </div>


          {/*
            Any room can be a sub-room of another on its storey — a closet pulled off the bedroom's
            wall, one drawn beside it corner by corner — not only one the drawing puts inside
            another, which is all the old two-button control ever offered. The list shows the parent
            as it stands, chosen or worked out from the drawing, and "Not a sub-room" is an explicit
            no. Sits directly under the name, where the control always was.
          */}
          {parentChoices.length > 0 && (
            <div className="question">
              <label className="prompt" htmlFor="sketch-room-parent">
                Sub-room of
              </label>
              <select
                id="sketch-room-parent"
                value={selectedRoom.parentRoomId ?? ""}
                onChange={(e) => setParentChoice(selectedRoom.id, e.target.value || null)}
              >
                <option value="">Not a sub-room</option>
                {parentChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${r.name.trim() || "Untitled room"} — ${roomSizeLabel(r)}`}
                  </option>
                ))}
              </select>
              <p className="field-note">
                {nestedInside && selectedRoom.parentRoomId !== nestedInside.id
                  ? `Drawn inside ${nestedInside.name.trim() || "another room"}, and kept separate from it.`
                  : nestedInside
                    ? `Drawn inside ${nestedInside.name.trim() || "another room"}: its floor and ceiling come out of that room's.`
                    : selectedRoom.parentRoomId
                      ? "Grouped with its parent for the scope; standing beside it, its floor and walls stay its own."
                      : "For a closet or alcove that belongs to another room — pulled off its wall, or drawn beside it."}
              </p>
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
              onRotate={() => handleRotateStairs(selectedRoom.id)}
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
                // Typed by hand: no longer the scan's default, whatever the scan said.
                updateRoom(selectedRoom.id, (room) => ({ ...room, ceilingHeightFeet: feet, ceilingMeasured: undefined }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            {/*
              A scan says whether its height is a measurement. The phone sends 8' when it read no
              ceiling anywhere, which is indistinguishable from a measured 8' on a document, so the
              claim's own note says which it is — and a measured one says so too, because an
              estimator who scanned the room should not have to remember whether this number came
              back with it.
            */}
            {selectedRoom.ceilingMeasured === false ? (
              <p className="field-note">
                <strong>Not measured.</strong> The scan read no ceiling in this room, so this is the{" "}
                {formatFeetInches(DEFAULT_CEILING_HEIGHT_FEET)} default — worth a tape before it reaches a document.
              </p>
            ) : selectedRoom.ceilingMeasured === true ? (
              <p className="field-note">Measured by the scan. Drives wall area, stair rise, and later volume-based equipment sizing.</p>
            ) : (
              <p className="field-note">Defaults to {formatFeetInches(DEFAULT_CEILING_HEIGHT_FEET)} — only worth changing when it isn&rsquo;t. Drives wall area, stair rise, and later volume-based equipment sizing.</p>
            )}
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
                      /*
                        And drop the scan's measured run: it was measured ACROSS a slope that is no
                        longer the one the room has, and keeping it would quietly size a hand-drawn
                        shape by a number from a different ceiling. The quantities fall back to the
                        room's own span — see `ceilingProfile`.
                      */
                      ceilingRunFeet: null,
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
                onAddCloset={selectedSymbol.type === "door" ? () => handleAddCloset(selectedRoom.id, selectedSymbol.id) : undefined}
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
            <>
              {/*
                Offered only when there is something to square, with the count in the label: a
                button that says what it is about to do needs no confirmation, and one that would
                do nothing should not be there to press.
              */}
              {leaning.length > 0 && (
                <div className="question">
                  <label className="prompt">Corners</label>
                  <div className="actions-row">
                    <button className="btn-secondary" onClick={() => handleSquareUp(selectedRoom.id)}>
                      Square up {leaning.length} corner{leaning.length === 1 ? "" : "s"}
                    </button>
                  </div>
                  <p className="field-note">
                    Moves each one the shortest way along its longer wall until the two walls meet square. A corner more
                    than {SQUARE_TOLERANCE_DEG}&deg; out is left alone — that is a shape somebody drew, not a slip.
                  </p>
                </div>
              )}
              <div className="actions-row">
                <button className="btn-secondary" onClick={() => handleDeleteRoom(selectedRoom.id)} title="Delete key">
                  Delete room
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "sketch" && !selectedRoom && selectedWall && (
        <div className="sketch-panel">
          <h3 className="sketch-panel-title">Wall</h3>
          <p className="field-note">
            {freeWallSegments(selectedWall)
              .map((piece) => formatFeetInches(piece.lengthFeet))
              .join(" + ")}
            {freeWallSegments(selectedWall).length > 1 ? ` — ${freeWallSegments(selectedWall).length} pieces` : ""}. Double-tap a piece to type its length; drag a corner to move it.
          </p>

          {/*
            Full height unless told otherwise. A pony wall is the reason to say otherwise: its faces
            stop at its own height and it has no ceiling line, which is what the quantities do with
            the number — see `roomQuantities`.
          */}
          <div className="question">
            <label className="prompt" htmlFor="sketch-wall-height">
              Wall height
            </label>
            <input
              id="sketch-wall-height"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="full height"
              key={`${selectedWall.id}-height`}
              defaultValue={selectedWall.heightFeet == null ? "" : formatFeetInches(selectedWall.heightFeet)}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  updateFreeWall(selectedWall.id, (wall) => ({ ...wall, heightFeet: null }));
                  return;
                }
                const feet = parseFeetInches(raw);
                if (feet == null || feet <= 0) {
                  e.target.value = selectedWall.heightFeet == null ? "" : formatFeetInches(selectedWall.heightFeet);
                  return;
                }
                updateFreeWall(selectedWall.id, (wall) => ({ ...wall, heightFeet: feet }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <p className="field-note">Leave blank for a wall to the ceiling. Set it for a pony or knee wall — its two faces count to that height, and it adds nothing at the ceiling line.</p>
          </div>

          <div className="actions-row">
            <button className="btn-secondary" onClick={() => handleDeleteWall(selectedWall.id)} title="Delete key">
              Delete wall
            </button>
          </div>
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

      {/*
        The bottom bar, and what it opens.

        Thumbs reach the bottom of a phone and not the top of it, so the tools that carry a
        walk-through sit there: Select, Wall, Door, then More for the rest — the same shape as the
        companion's chip bar, because the same estimator uses both in the same hour. Above it, one
        line saying what a tap will do now. Both sheets are the card's children rather than the
        body's, so they rise over the plan instead of scrolling with it.
      */}
      {phone && (
        <>
          {!readOnly && <p className="field-note sketch-bar-line">{hintText}</p>}
          <div className="sketch-bar" role="toolbar" aria-label={mode === "moisture" ? "Moisture tools" : "Sketch tools"}>
            <div className="sketch-bar-tools">
              {!readOnly && (mode === "moisture"
                ? moistureKeys(moistureTool).bar.map((key) => moistureNodes[key])
                : SKETCH_BAR_KEYS.map((key) => toolNodes[key]))}
            </div>
            {/* Outside the row that scrolls: the tools can run off the end of a 360px bar, and the
                way to the ones that did must not be the thing that ran off it. */}
            <button
              ref={moreButtonRef}
              type="button"
              className={`option-btn sketch-bar-more${sheet === "more" ? " selected" : ""}`}
              aria-pressed={sheet === "more"}
              aria-expanded={sheet === "more"}
              onClick={() => setSheet((open) => (open === "more" ? "none" : "more"))}
            >
              More…
            </button>
            {zoomControls(false)}
          </div>
          {/*
            Only More darkens the plan behind it.

            The properties sheet is not a dialog — it is what is selected, and the plan has to stay
            live underneath: the second tap of a double-tap to type a wall length was landing on the
            backdrop, which put the sheet away instead of opening the length box. Tapping the plan
            with the sheet up selects something else and the sheet follows it, which is what an
            inspector should do. More is a menu, so it is modal and a tap off it puts it away.
          */}
          {sheet === "more" && (
            <button
              type="button"
              className="sketch-sheet-backdrop"
              /* Hidden from the keyboard and from a screen reader: it is a gesture, not a control,
                 and as a control it was an invisible "Close" covering the whole editor, announced
                 immediately before the sheet's own Close. */
              aria-hidden="true"
              tabIndex={-1}
              onClick={closeSheet}
            />
          )}
          <div className={`sketch-sheet sketch-sheet-more${sheet === "more" ? " sketch-sheet-open" : ""}`} aria-hidden={sheet !== "more"}>
            <div className="sketch-sheet-head">
              <span className="sketch-sheet-grip" aria-hidden="true" />
              <button type="button" className="btn-secondary" onClick={closeSheet}>
                Close
              </button>
            </div>
            {levelStrip}
            {!readOnly && (
              <div
                className="sketch-sheet-grid"
                /*
                  Picking a tool puts the sheet away, because the next thing to do is tap the plan
                  and the sheet is over it — Window then meant Window, Close, tap. A tap on the
                  fixture picker must NOT close it, since its menu is still open at that moment, so
                  that one closes on its change instead.
                */
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button") !== null) closeSheet();
                }}
                onChange={closeSheet}
              >
                {mode === "moisture"
                  ? moistureKeys(moistureTool).more.map((key) => moistureNodes[key])
                  : sketchMoreKeys().map((key) => toolNodes[key])}
              </div>
            )}
            {/* Read-only has no tools to list, so Sizes is offered on its own: a locked plan is
                looked at, and the measurements are most of what there is to look at. */}
            {readOnly && <div className="sketch-sheet-grid">{toolNodes.sizes}</div>}
            <div className="sketch-sheet-row">
              <button type="button" className="btn-secondary" onClick={() => setView(fitToLevel())}>
                Reset zoom
              </button>
              {/* The way to the quantities and the wall lengths with nothing selected — otherwise
                  the sheet they live in only ever rises for a selection. */}
              <button type="button" className="btn-secondary" onClick={() => setSheet("details")}>
                Quantities & data
              </button>
            </div>
          </div>
        </>
      )}
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
  onDoorType,
  onRotateStairs,
  onFlipStairs,
}: {
  room: SketchRoom | null;
  symbol: SketchSymbol | null;
  onFlipDoor: (axis: "x" | "y") => void;
  onDoorType: (type: DoorType) => void;
  onRotateStairs: () => void;
  onFlipStairs: () => void;
}) {
  const door = symbol?.type === "door" ? symbol : null;
  const stairs = !symbol && room?.stairs ? room.stairs : null;
  if (!door && !stairs) return null;

  return (
    <div className="sketch-direction" role="group" aria-label={door ? "Door" : "Stair direction"}>
      {door && (
        <>
          {/*
            The type, here as well as in the panel. On a phone in full screen the panel is a long
            scroll away — leave full screen, find the door, scroll down — for what is one tap on the
            drawing. A select rather than five buttons, because the bar has to stay a bar.
          */}
          <select
            className="sketch-fixture-select selected"
            aria-label="Door type"
            value={door.doorType}
            onChange={(e) => onDoorType(e.target.value as DoorType)}
          >
            {(Object.keys(DOOR_TYPE_LABEL) as DoorType[]).map((type) => (
              <option key={type} value={type}>
                {DOOR_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          {/* An opening has no leaf, so there is nothing to hand or swing — same exclusion the panel makes. */}
          {door.doorType !== "opening" && (
            <>
              <button type="button" className="btn-secondary" onClick={() => onFlipDoor("x")} title="Mirror left to right (← →)">
                ⇆ Flip
              </button>
              <button type="button" className="btn-secondary" onClick={() => onFlipDoor("y")} title="Mirror top to bottom (↑ ↓)">
                ⇅ Flip
              </button>
            </>
          )}
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
