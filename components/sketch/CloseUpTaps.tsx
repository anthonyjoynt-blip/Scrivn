"use client";

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import styles from "./PhotoRoute.module.css";

/** A photo to tap on: its picture and its stored size, and what it is called. */
interface TapPhotoInfo {
  url: string | null;
  width: number;
  height: number;
  label: string;
}

type Pair = { d: [number, number] | null; f: [number, number] | null };

/** How far in a photo can be shown, to put a point on a corner with a finger. */
const ZOOMS = [1, 2, 4] as const;

/**
 * A close-up laid on its wall by hand (2026-10-23): the same point tapped on the close-up, then on its wall's photo, four
 * times or more - a window's corner, the end of a sill, a trim corner, each on the wall's face. Either photo shown 2x or 4x
 * to tap precisely (a finger drags it about). A tap on the close-up starts the next point, or moves the one not yet on the
 * wall's photo; a tap on the wall's photo puts the point there, or moves the last. Undo takes the last off.
 */
export function CloseUpTaps({
  detail,
  full,
  initial,
  onDone,
  onCancel,
}: {
  detail: TapPhotoInfo;
  full: TapPhotoInfo;
  initial: [number, number, number, number][] | null;
  onDone: (points: [number, number, number, number][]) => void;
  onCancel: () => void;
}) {
  const [pairs, setPairs] = useState<Pair[]>(() => (initial ?? []).map((p) => ({ d: [p[0], p[1]], f: [p[2], p[3]] })));
  const last = pairs[pairs.length - 1];
  const waitingFull = !!last && !!last.d && !last.f;
  const complete = pairs.filter((p): p is { d: [number, number]; f: [number, number] } => !!p.d && !!p.f);
  const next = complete.length + 1;

  const tapDetail = (x: number, y: number) =>
    setPairs((ps) => {
      const l = ps[ps.length - 1];
      if (l && l.d && !l.f) return [...ps.slice(0, -1), { d: [x, y], f: null }];
      return [...ps, { d: [x, y], f: null }];
    });
  const tapFull = (x: number, y: number) =>
    setPairs((ps) => {
      const l = ps[ps.length - 1];
      if (!l || !l.d) return ps;
      return [...ps.slice(0, -1), { d: l.d, f: [x, y] }];
    });
  const undo = () =>
    setPairs((ps) => {
      const l = ps[ps.length - 1];
      if (!l) return ps;
      return l.f ? [...ps.slice(0, -1), { d: l.d, f: null }] : ps.slice(0, -1);
    });

  return (
    <div className={styles.closeUpTaps}>
      <p className={styles.closeUpSay}>
        {waitingFull ? (
          <>
            <strong>Point {pairs.length}: now the same point on {full.label}.</strong> Tap the close-up again to move it.
          </>
        ) : (
          <>
            <strong>
              Point {next}: tap it on {detail.label}
            </strong>
            {next === 1 ? " - a window's corner, the end of a sill, a trim corner: on the wall itself, not a post or a rail in front of it." : complete.length >= 4 ? ", or Lay it now." : "."}{" "}
            Four or more, spread out, three never in a line.
          </>
        )}
      </p>
      <TapPhoto info={detail} active={!waitingFull} marks={pairs.map((p, k) => (p.d ? { at: p.d, label: String(k + 1), open: !p.f } : null))} onTap={tapDetail} />
      <TapPhoto info={full} active={waitingFull} marks={pairs.map((p, k) => (p.f ? { at: p.f, label: String(k + 1), open: false } : null))} onTap={tapFull} />
      <div className={styles.row}>
        <button type="button" className="btn-primary" disabled={complete.length < 4 || waitingFull} onClick={() => onDone(complete.map((p) => [p.d[0], p.d[1], p.f[0], p.f[1]]))}>
          {complete.length < 4 ? `Lay it (${complete.length} of 4 points)` : `Lay it on the wall (${complete.length} points)`}
        </button>
        <button type="button" className="btn-secondary" disabled={pairs.length === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One photo to tap on, with its points numbered; shown larger to tap precisely, the box then dragged about. */
function TapPhoto({ info, active, marks, onTap }: { info: TapPhotoInfo; active: boolean; marks: ({ at: [number, number]; label: string; open: boolean } | null)[]; onTap: (x: number, y: number) => void }) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const svg = useRef<SVGSVGElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const toPhoto = (e: ReactPointerEvent): [number, number] => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return [((e.clientX - box.left) / box.width) * info.width, ((e.clientY - box.top) / box.height) * info.height];
  };
  // Marks the same size on the screen at any zoom: about 9 CSS pixels on a phone at 1x.
  const r = info.width / 40 / zoom;
  return (
    <div className={`${styles.tapPhoto} ${active ? styles.tapPhotoOn : ""}`}>
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
      <div className={styles.tapScroll}>
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
              if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) onTap(...toPhoto(e));
            }}
          >
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
