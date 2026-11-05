"use client";

import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./PhotoRoute.module.css";

/** A photo to tap on: its picture and its stored size, and what it is called. */
export interface TapPhotoInfo {
  url: string | null;
  width: number;
  height: number;
  label: string;
}

export interface TapMark {
  at: [number, number];
  label: string;
  open: boolean;
}

/** How far in a photo can be shown, to put a point on a corner with a finger. */
export const ZOOMS = [1, 2, 4] as const;
export type TapZoom = (typeof ZOOMS)[number];

/**
 * One photo to tap on, with its points numbered; shown larger to tap precisely, the box then dragged about (2026-10-23,
 * shared 2026-11-05 with the drop-a-sketch tracer). Taps come back in the photo's own pixels, with how many of them one
 * CSS pixel spans at the zoom shown — what "near" means for a finger. [overlay] draws more in the photo's pixels, given
 * that same span so its lines and labels stay one size on the screen.
 */
export function TapPhoto({
  info,
  active,
  marks = [],
  onTap,
  overlay,
  zoom: zoomShown,
  onZoom,
  head = true,
  fill = false,
}: {
  info: TapPhotoInfo;
  active: boolean;
  marks?: (TapMark | null)[];
  onTap: (x: number, y: number, at: { pxPerCss: number }) => void;
  overlay?: (pxPerCss: number) => ReactNode;
  /** The zoom, when the page sets it; otherwise the photo keeps its own. */
  zoom?: TapZoom;
  onZoom?: (zoom: TapZoom) => void;
  /** The label and the 1x 2x 4x buttons above the photo. */
  head?: boolean;
  /** Fill the height given rather than stopping at 70% of the screen. */
  fill?: boolean;
}) {
  const [ownZoom, setOwnZoom] = useState<TapZoom>(1);
  const zoom = zoomShown ?? ownZoom;
  const setZoom = (z: TapZoom) => (onZoom ? onZoom(z) : setOwnZoom(z));
  const svg = useRef<SVGSVGElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Photo pixels per CSS pixel at the zoom shown, measured, for the overlay and for what counts as near.
  const [pxPerCss, setPxPerCss] = useState(info.width / 360);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setPxPerCss(info.width / w);
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [info.width, zoom]);
  const toPhoto = (e: ReactPointerEvent): [number, number] => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return [((e.clientX - box.left) / box.width) * info.width, ((e.clientY - box.top) / box.height) * info.height];
  };
  // Marks the same size on the screen at any zoom: about 9 CSS pixels on a phone at 1x.
  const r = info.width / 40 / zoom;
  return (
    <div className={`${styles.tapPhoto} ${active ? styles.tapPhotoOn : ""}`} style={fill ? { height: "100%", display: "flex", flexDirection: "column" } : undefined}>
      {head ? (
        <div className={styles.tapPhotoHead}>
          <span>{info.label}</span>
          <span className={styles.tapZooms} role="group" aria-label={`Show ${info.label} larger`}>
            {ZOOMS.map((z) => (
              <button key={z} type="button" className={`option-btn${zoom === z ? " selected" : ""}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                {z}x
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <div className={styles.tapScroll} style={fill ? { flex: 1, maxHeight: "none", minHeight: 0 } : undefined}>
        <div className={styles.photoBox} style={{ width: `${zoom * 100}%`, maxWidth: "none" }}>
          {info.url ? <img src={info.url} alt={info.label} draggable={false} /> : <div style={{ aspectRatio: `${info.width} / ${info.height}`, background: "#e7e5e4" }} />}
          <svg
            ref={svg}
            className={styles.tapOverlay}
            viewBox={`0 0 ${info.width} ${info.height}`}
            onPointerDown={(e) => {
              start.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
            onPointerUp={(e) => {
              const s = start.current;
              start.current = null;
              // A tap, not a drag about the photo.
              if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) onTap(...toPhoto(e), { pxPerCss });
            }}
          >
            {overlay ? <g pointerEvents="none">{overlay(pxPerCss)}</g> : null}
            {marks.map((m, k) =>
              m ? (
                <g key={k} pointerEvents="none">
                  <line x1={m.at[0] - r * 1.6} y1={m.at[1]} x2={m.at[0] + r * 1.6} y2={m.at[1]} stroke="#fff" strokeWidth={r / 3} />
                  <line x1={m.at[0]} y1={m.at[1] - r * 1.6} x2={m.at[0]} y2={m.at[1] + r * 1.6} stroke="#fff" strokeWidth={r / 3} />
                  <line x1={m.at[0] - r * 1.6} y1={m.at[1]} x2={m.at[0] + r * 1.6} y2={m.at[1]} stroke="#ea580c" strokeWidth={r / 7} />
                  <line x1={m.at[0]} y1={m.at[1] - r * 1.6} x2={m.at[0]} y2={m.at[1] + r * 1.6} stroke="#ea580c" strokeWidth={r / 7} />
                  <circle cx={m.at[0]} cy={m.at[1]} r={r} fill="none" stroke={m.open ? "#7c3aed" : "#ea580c"} strokeWidth={r / 5} />
                  <text x={m.at[0] + r * 1.3} y={m.at[1] - r * 1.1} fontSize={r * 1.7} fill="#fff" stroke="#9a3412" strokeWidth={r / 4} paintOrder="stroke">
                    {m.label}
                  </text>
                </g>
              ) : null,
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
