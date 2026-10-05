"use client";

/**
 * A 360° spot, one still at a time (2026-10-05): the stills the phone took, each as it took it, gone
 * round with left and right and up and down, and zoomed into. Why, and how the stills are put in order:
 * lib/spotStills.ts. It stands over walk mode's 3D view (components/sketch/Sketch3D.tsx) while the view is
 * at a spot; the plan in the corner and the bar along the bottom stay on top of it.
 *
 * Left and right turn round the ring, up and down go to the ring above or below - the buttons, the
 * arrow keys (through [SpotStillsApi]), or a swipe, which grabs the room the way a drag of the 3D view
 * did: a swipe to the left turns right, a swipe up looks down. Zoom by the wheel or a pinch about the
 * pointer, a double click or tap to go in close and back, or the buttons; zoomed in, a drag moves about
 * the still. Each turn shows the next still whole again.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { viewpointId, type Viewpoint } from "@/lib/walkView";
import {
  clampZoom,
  FIT,
  lookOfStill,
  MAX_ZOOM,
  nearestStill,
  placeStill,
  ringFor,
  stillRings,
  turnIndex,
  zoomAbout,
  type RingKind,
  type Stage,
  type StillZoom,
} from "@/lib/spotStills";

/** What the controls outside can ask of the stills: the arrow keys and the zoom keys. */
export interface SpotStillsApi {
  turn: (by: 1 | -1) => void;
  tilt: (by: 1 | -1) => void;
  zoomBy: (factor: number) => void;
  fit: () => void;
}

/** Which still is showing, for the bar along the bottom. */
export interface StillShown {
  kind: RingKind;
  index: number;
  count: number;
}

interface Props {
  spot: Viewpoint;
  /** The spot's scan's photo links by photo number; undefined while they are still on their way. */
  urls: Record<number, string> | undefined;
  /** The way the view faces as a spot comes up (radians, the view's turn); null when it does not know. */
  startYaw: () => number | null;
  /** Where the still being shown looks, for the plan's wedge and the 3D view behind. */
  onLook: (yaw: number, pitch: number) => void;
  onShown: (shown: StillShown) => void;
  apiRef: Ref<SpotStillsApi | null>;
}

/** The stage's margins the still is fitted inside at a zoom of 1: clear of the bar along the bottom. */
const FIT_INSET = { top: 8, side: 8, bottom: 76 };
/** One press of a zoom button or key. */
const ZOOM_STEP = 1.6;
/** A double click or tap goes this close in. */
const DOUBLE_ZOOM = 2.5;
/** A second tap within this long and this near the first is a double tap: ms, CSS pixels. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** A drag further than this is a drag and not a tap: CSS pixels. */
const DRAG_PX = 8;
/** Stills held decoded at once, the least lately wanted let go first. */
const MAX_HELD = 40;

const RING_WORD: Record<RingKind, string> = { up: "looking up", level: "looking level", down: "looking down" };

/** Which still is showing, in words: "looking down, photo 2 of 6". */
export function stillWords(s: StillShown): string {
  return `${RING_WORD[s.kind]}, photo ${s.index + 1} of ${s.count}`;
}

type Gesture =
  | { kind: "pan"; id: number; x0: number; y0: number; from: StillZoom }
  | { kind: "swipe"; id: number; x0: number; y0: number; t0: number; axis: "x" | "y" | null }
  | { kind: "pinch"; d0: number; mx0: number; my0: number; from: StillZoom };

export default function SpotStills({ spot, urls, startYaw, onLook, onShown, apiRef }: Props) {
  const rings = useMemo(() => stillRings(spot), [spot]);
  const spotId = viewpointId(spot.key);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Which still: a ring and a place round it. The ring's kind is kept from spot to spot.
  const [place, setPlace] = useState<{ spotId: string; ring: number; index: number }>(() => {
    const ring = ringFor(rings, "level");
    const yaw = startYaw();
    return { spotId, ring, index: yaw == null ? 0 : nearestStill(rings[ring] as (typeof rings)[number], yaw) };
  });
  const kindRef = useRef<RingKind>(rings[place.ring]?.kind ?? "level");
  const [zoom, setZoom] = useState<StillZoom>(FIT);
  // The still on the stage: the last one wanted whose picture has arrived, and its size.
  const [shown, setShown] = useState<{ url: string; width: number; height: number; n: number } | null>(null);
  const [slow, setSlow] = useState(false);
  // A picture that would not load, so the one before it is not left up as if it were this one.
  const [broken, setBroken] = useState<string | null>(null);
  // While a finger swipes a still that is not zoomed: how far it has been dragged, CSS pixels.
  const [swipe, setSwipe] = useState<{ dx: number; dy: number } | null>(null);
  // Which way the last turn went, for the still coming in from that side.
  const [entering, setEntering] = useState<"left" | "right" | "up" | "down" | null>(null);
  // A swipe let go short of a turn: the still slides back into place.
  const [snapping, setSnapping] = useState(false);

  // A new spot: the same kind of ring when it has one, facing as near the way the view faced as it can.
  if (place.spotId !== spotId) {
    const ring = ringFor(rings, kindRef.current);
    const yaw = startYaw();
    setPlace({ spotId, ring, index: yaw == null ? 0 : nearestStill(rings[ring] as (typeof rings)[number], yaw) });
    setZoom(FIT);
    setEntering(null);
  }
  const ring = rings[place.ring] ?? rings[0];
  const still = ring?.stills[place.index] ?? ring?.stills[0] ?? null;
  const url = still && urls ? urls[still.n] ?? null : null;

  const stage: Stage | null = useMemo(
    () =>
      size && {
        width: size.width,
        height: size.height,
        fit: {
          left: FIT_INSET.side,
          top: FIT_INSET.top,
          width: Math.max(1, size.width - 2 * FIT_INSET.side),
          height: Math.max(1, size.height - FIT_INSET.top - FIT_INSET.bottom),
        },
      },
    [size],
  );

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // ---- The pictures: the one wanted, then the rest of the spot nearest first ----------------------
  const held = useRef(new Map<string, { img: HTMLImageElement; ready: Promise<HTMLImageElement>; usedAt: number }>());
  const fetchPicture = useCallback((src: string) => {
    const map = held.current;
    const had = map.get(src);
    if (had) {
      had.usedAt = performance.now();
      return had.ready;
    }
    const img = new Image();
    img.decoding = "async";
    const ready = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${src}`));
    });
    img.src = src;
    map.set(src, { img, ready, usedAt: performance.now() });
    if (map.size > MAX_HELD) {
      const oldest = [...map.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt).slice(0, map.size - MAX_HELD);
      for (const [key, entry] of oldest) {
        entry.img.onload = null;
        entry.img.onerror = null;
        entry.img.src = "";
        map.delete(key);
      }
    }
    ready.catch(() => map.delete(src));
    return ready;
  }, []);

  useEffect(() => {
    if (!url || !still) return;
    let cancelled = false;
    const slowTimer = window.setTimeout(() => setSlow(true), 250);
    fetchPicture(url)
      .then((img) => {
        if (cancelled) return;
        setShown({ url, width: img.naturalWidth, height: img.naturalHeight, n: still.n });
      })
      .catch(() => {
        if (!cancelled) setBroken(url);
      })
      .finally(() => {
        window.clearTimeout(slowTimer);
        if (!cancelled) setSlow(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [url, still, fetchPicture]);

  // The rest of the spot, a few at a time: round the ring from the still shown, then the other rings.
  useEffect(() => {
    if (!urls || !ring) return;
    const order: Viewpoint[] = [];
    const n = ring.stills.length;
    for (let k = 1; k <= Math.ceil(n / 2); k++) {
      order.push(ring.stills[turnIndex(ring, place.index, k)] as Viewpoint, ring.stills[turnIndex(ring, place.index, -k)] as Viewpoint);
    }
    for (const r of rings) if (r !== ring) order.push(...r.stills);
    const queue = [...new Set(order.map((s) => urls[s.n]).filter((u): u is string => !!u))];
    let cancelled = false;
    const next = () => {
      const src = queue.shift();
      if (!src || cancelled) return;
      fetchPicture(src).catch(() => undefined).finally(next);
    };
    for (let k = 0; k < 3; k++) next();
    return () => {
      cancelled = true;
    };
  }, [urls, rings, ring, place.index, fetchPicture]);

  // ---- Where the still looks, and which it is --------------------------------------------------
  useEffect(() => {
    if (!still || !ring) return;
    const look = lookOfStill(still);
    onLook(look.yaw, look.pitch);
    onShown({ kind: ring.kind, index: place.index, count: ring.stills.length });
  }, [still, ring, place.index, onLook, onShown]);

  // ---- Going round ----------------------------------------------------------------------------
  const turn = useCallback(
    (by: 1 | -1) => {
      if (!ring || ring.stills.length < 2) return;
      setPlace((p) => ({ ...p, index: turnIndex(ring, p.index, by) }));
      setZoom(FIT);
      setEntering(by > 0 ? "right" : "left");
    },
    [ring],
  );
  /** Down a ring (by 1) or up one (by -1), to its still facing nearest the way this one does. */
  const tilt = useCallback(
    (by: 1 | -1) => {
      const to = rings[place.ring + by];
      if (!to || !still) return;
      kindRef.current = to.kind;
      setPlace((p) => ({ ...p, ring: p.ring + by, index: nearestStill(to, lookOfStill(still).yaw) }));
      setZoom(FIT);
      setEntering(by > 0 ? "down" : "up");
    },
    [rings, place.ring, still],
  );
  const zoomAt = useCallback(
    (scale: (s: number) => number, px?: number, py?: number) => {
      if (!stage || !shown) return;
      setZoom((z) => zoomAbout(stage, shown.width, shown.height, z, scale(z.scale), px ?? stage.width / 2, py ?? stage.fit.top + stage.fit.height / 2));
    },
    [stage, shown],
  );
  useImperativeHandle(
    apiRef,
    () => ({
      turn,
      tilt,
      zoomBy: (factor) => zoomAt((s) => s * factor),
      fit: () => setZoom(FIT),
    }),
    [turn, tilt, zoomAt],
  );

  // The zoom kept sensible when the stage changes size.
  useEffect(() => {
    if (stage && shown) setZoom((z) => clampZoom(stage, shown.width, shown.height, z));
  }, [stage, shown]);

  // ---- Pointer: swipe, drag, pinch, double tap; the wheel ---------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // A finger's double tap is caught by its taps; the browser may send a double click for it too, which is not taken twice.
  const lastPointerType = useRef("mouse");
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const pinchOf = () => {
    const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const startOne = (id: number, p: { x: number; y: number }) => {
    gesture.current = zoomRef.current.scale > 1.001 ? { kind: "pan", id, x0: p.x, y0: p.y, from: zoomRef.current } : { kind: "swipe", id, x0: p.x, y0: p.y, t0: performance.now(), axis: null };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lastPointerType.current = e.pointerType;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer already gone: its moves simply stop at the stage's edge.
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const { d, mx, my } = pinchOf();
      gesture.current = { kind: "pinch", d0: d, mx0: mx, my0: my, from: zoomRef.current };
      setSwipe(null);
    } else if (pointers.current.size === 1) {
      startOne(e.pointerId, p);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g || !stage || !shown) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const { d, mx, my } = pinchOf();
      const scale = Math.min(MAX_ZOOM, Math.max(1, (g.from.scale * d) / g.d0));
      // What was under the fingers' middle at the start stays under it, wherever the fingers go.
      const cx = stage.fit.left + stage.fit.width / 2;
      const cy = stage.fit.top + stage.fit.height / 2;
      const ux = (g.mx0 - cx - g.from.tx) / g.from.scale;
      const uy = (g.my0 - cy - g.from.ty) / g.from.scale;
      setZoom(clampZoom(stage, shown.width, shown.height, { scale, tx: mx - cx - ux * scale, ty: my - cy - uy * scale }));
    } else if (g.kind === "pan" && g.id === e.pointerId) {
      setZoom(clampZoom(stage, shown.width, shown.height, { ...g.from, tx: g.from.tx + p.x - g.x0, ty: g.from.ty + p.y - g.y0 }));
    } else if (g.kind === "swipe" && g.id === e.pointerId) {
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      if (!g.axis && Math.hypot(dx, dy) > DRAG_PX) g.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      // Only a way there is somewhere to go follows the finger.
      const canX = (ring?.stills.length ?? 0) > 1;
      const canY = (dy < 0 && !!rings[place.ring + 1]) || (dy > 0 && !!rings[place.ring - 1]);
      if (g.axis === "x") setSwipe({ dx: canX ? dx : dx * 0.25, dy: 0 });
      else if (g.axis === "y") setSwipe({ dx: 0, dy: canY ? dy : dy * 0.25 });
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      // One finger left on: it carries on moving the still about.
      const [id, q] = [...pointers.current.entries()][0] ?? [];
      if (id != null && q) startOne(id, q);
      else gesture.current = null;
      lastTap.current = null;
      return;
    }
    gesture.current = null;
    if (g?.kind === "swipe" && stage) {
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      const dt = Math.max(1, performance.now() - g.t0);
      setSwipe(null);
      const far = Math.min(90, stage.width * 0.15);
      if (g.axis === "x" && (Math.abs(dx) > far || (Math.abs(dx) > 30 && Math.abs(dx) / dt > 0.5))) {
        turn(dx < 0 ? 1 : -1);
        lastTap.current = null;
        return;
      }
      if (g.axis === "y" && (Math.abs(dy) > far || (Math.abs(dy) > 30 && Math.abs(dy) / dt > 0.5))) {
        tilt(dy < 0 ? 1 : -1);
        lastTap.current = null;
        return;
      }
      if (g.axis) {
        setSnapping(true);
        window.setTimeout(() => setSnapping(false), 160);
        return;
      }
    }
    if (g?.kind === "pan" && Math.hypot(p.x - g.x0, p.y - g.y0) > DRAG_PX) return;
    // A tap: a second one close behind the first goes in close, or back out.
    if (e.pointerType === "mouse") return; // the mouse's double click is its own event
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      doubleAt(p.x, p.y);
    } else {
      lastTap.current = { t: now, x: p.x, y: p.y };
    }
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setSwipe(null);
  };
  const doubleAt = (x: number, y: number) => {
    if (zoomRef.current.scale > 1.05) setZoom(FIT);
    else zoomAt(() => DOUBLE_ZOOM, x, y);
  };

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      // A trackpad's pinch comes as the wheel with ctrl held, in small steps.
      const k = e.ctrlKey ? 0.01 : 0.002;
      const factor = Math.exp(-e.deltaY * lines * k);
      zoomAt((s) => s * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---- Drawing ----------------------------------------------------------------------------------
  const box = stage && shown ? placeStill(stage, shown.width, shown.height, zoom) : null;
  const canUp = !!rings[place.ring - 1];
  const canDown = !!rings[place.ring + 1];
  const canTurn = (ring?.stills.length ?? 0) > 1;
  const zoomed = zoom.scale > 1.001;
  const message = !urls
    ? "Loading the photos…"
    : !url
      ? "This photo hasn't arrived from the phone yet"
      : broken === url
        ? "This photo couldn't be loaded"
        : slow || !shown
          ? "Loading the photo…"
          : null;
  // The picture on the stage is the one wanted, or the one before while it loads - never one standing in for a missing one.
  const showPicture = !!shown && !!url && broken !== url;
  const where = ring ? stillWords({ kind: ring.kind, index: place.index, count: ring.stills.length }) : "";

  return (
    <div
      ref={stageRef}
      role="group"
      aria-roledescription="360° photos"
      aria-label={`The photos of this 360° spot: ${where}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button") || lastPointerType.current !== "mouse") return;
        const p = local(e);
        doubleAt(p.x, p.y);
      }}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#151a21",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: zoomed ? "grab" : "default",
      }}
    >
      <style>{STILL_KEYFRAMES}</style>
      {showPicture && shown && box && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={shown.n}
          src={shown.url}
          alt={`360° spot photo, ${where}`}
          draggable={false}
          className={entering && !zoomed ? `spot-still-in-${entering}` : undefined}
          style={{
            position: "absolute",
            left: box.left + (swipe?.dx ?? 0),
            top: box.top + (swipe?.dy ?? 0),
            width: box.width,
            height: box.height,
            maxWidth: "none",
            maxHeight: "none",
            pointerEvents: "none",
            transition: snapping ? "left 150ms ease-out, top 150ms ease-out" : "none",
          }}
        />
      )}
      {message && (
        <p style={{ position: "absolute", left: 0, right: 0, top: "45%", margin: 0, textAlign: "center", color: "#d5dbe3", fontSize: 14, pointerEvents: "none" }}>{message}</p>
      )}
      {canTurn && (
        <>
          <button type="button" aria-label="Turn left" title="Turn left (←)" onClick={() => turn(-1)} style={{ ...ROUND, left: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Chevron dir="left" />
          </button>
          <button type="button" aria-label="Turn right" title="Turn right (→)" onClick={() => turn(1)} style={{ ...ROUND, right: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Chevron dir="right" />
          </button>
        </>
      )}
      <div style={{ position: "absolute", right: 12, top: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {canUp && (
          <button type="button" aria-label="Look up" title="Look up (↑)" onClick={() => tilt(-1)} style={{ ...ROUND, position: "static" }}>
            <Chevron dir="up" />
          </button>
        )}
        {canDown && (
          <button type="button" aria-label="Look down" title="Look down (↓)" onClick={() => tilt(1)} style={{ ...ROUND, position: "static" }}>
            <Chevron dir="down" />
          </button>
        )}
        <span style={{ height: 4 }} />
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomAt((s) => s * ZOOM_STEP)} disabled={!shown || zoom.scale >= MAX_ZOOM - 1e-3} style={{ ...ROUND, position: "static", fontSize: 22 }}>
          +
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomAt((s) => s / ZOOM_STEP)} disabled={!zoomed} style={{ ...ROUND, position: "static", fontSize: 22 }}>
          −
        </button>
        {zoomed && (
          <button type="button" aria-label="Show the whole photo" title="The whole photo (0)" onClick={() => setZoom(FIT)} style={{ ...ROUND, position: "static", fontSize: 11, fontWeight: 600 }}>
            Fit
          </button>
        )}
      </div>
    </div>
  );
}

/** A round button over the photo. */
const ROUND: CSSProperties = {
  position: "absolute",
  width: 44,
  height: 44,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.28)",
  background: "rgba(16,22,30,0.62)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
  lineHeight: 1,
};

function Chevron({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const rotate = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M6.5 3.5 L12 9 L6.5 14.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A still coming in from the side it was turned to, briefly. */
const STILL_KEYFRAMES = `
@keyframes spot-still-in-right { from { transform: translateX(28px); opacity: 0.35; } to { transform: none; opacity: 1; } }
@keyframes spot-still-in-left { from { transform: translateX(-28px); opacity: 0.35; } to { transform: none; opacity: 1; } }
@keyframes spot-still-in-down { from { transform: translateY(28px); opacity: 0.35; } to { transform: none; opacity: 1; } }
@keyframes spot-still-in-up { from { transform: translateY(-28px); opacity: 0.35; } to { transform: none; opacity: 1; } }
.spot-still-in-right { animation: spot-still-in-right 170ms ease-out; }
.spot-still-in-left { animation: spot-still-in-left 170ms ease-out; }
.spot-still-in-down { animation: spot-still-in-down 170ms ease-out; }
.spot-still-in-up { animation: spot-still-in-up 170ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .spot-still-in-right, .spot-still-in-left, .spot-still-in-down, .spot-still-in-up { animation: none; }
}
`;
