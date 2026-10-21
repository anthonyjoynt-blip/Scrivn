"use client";

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import type { CornerTap, RouteTape, TapeWhat } from "@/lib/photoRoute";
import { formatFeetInches } from "@/lib/sketch";
import { FeetInchesInput } from "./FeetInchesInput";
import styles from "./PhotoRoute.module.css";

/**
 * The photo route's pieces shared by its pane (PhotoRoute.tsx) and the walk round the house (PhotoWalk.tsx, 2026-10-21):
 * a photo taking taps and drags, and the form a tape's length is put in on.
 */

export const WHAT_LABEL: Record<TapeWhat, string> = { garage: "Garage door", door: "Door", window: "Window", wall: "Wall", other: "Other" };

/**
 * Where a tape's ends go, by what was taped. A window or a door across its frame, edge to edge (2026-10-21: the owner
 * taped his windows across the white vinyl frame, not the stucco round it - the frame's edges are what a photo shows).
 */
export const WHAT_HINT: Record<TapeWhat, string> = {
  garage: "The door itself, side to side.",
  door: "Across its frame, edge to edge: the frame itself, not the trim round it.",
  window: "Across its frame, edge to edge: the frame itself, not the trim or the stucco round it.",
  wall: "Corner to corner.",
  other: "End to end, along the wall.",
};

/** A photo with its corner taps (numbered, or ? until numbered) and its tapes, taking taps and drags in its own pixels. */
export function PhotoTaps({
  url,
  width,
  height,
  taps,
  tapes,
  line,
  mode,
  selected,
  onTap,
  onPickTap,
  onLine,
  deckTaps = [],
}: {
  url: string | null;
  width: number;
  height: number;
  taps: { c: CornerTap; i: number }[];
  tapes: Extract<RouteTape, { kind: "line" }>[];
  line: { a: [number, number]; b: [number, number] } | null;
  mode: "corners" | "ends" | "tape" | "wall" | "deck" | null;
  selected: number | null;
  onTap: (x: number, y: number) => void;
  onPickTap: (i: number) => void;
  onLine: (a: [number, number], b: [number, number]) => void;
  /** A deck's taps on this photo (2026-10-20): each with its short label. */
  deckTaps?: { x: number; y: number; label: string }[];
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const start = useRef<{ x: number; y: number; px: [number, number] } | null>(null);
  const toPhoto = (e: ReactPointerEvent): [number, number] => {
    const el = svg.current;
    if (!el) return [0, 0];
    const box = el.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * width, ((e.clientY - box.top) / box.height) * height];
  };
  const r = width / 90;
  const shown = drag ?? line;
  return (
    <div className={styles.photoBox}>
      {url ? <img src={url} alt="The photo, to tap the corners on" draggable={false} /> : <div style={{ aspectRatio: `${width} / ${height}`, background: "#e7e5e4" }} />}
      <svg
        ref={svg}
        className={styles.overlay}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={(e) => {
          if (!mode || mode === "wall") return;
          start.current = { x: e.clientX, y: e.clientY, px: toPhoto(e) };
          if (mode === "tape") (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (mode === "tape" && start.current) setDrag({ a: start.current.px, b: toPhoto(e) });
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s || !mode) return;
          const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
          if ((mode === "corners" || mode === "ends" || mode === "deck") && moved < 10) onTap(...toPhoto(e));
          if (mode === "tape") {
            const b = toPhoto(e);
            setDrag(null);
            if (Math.hypot(b[0] - s.px[0], b[1] - s.px[1]) > width / 60) onLine(s.px, b);
          }
        }}
      >
        {tapes.map((t) => (
          <g key={t.id}>
            <line x1={t.a[0]} y1={t.a[1]} x2={t.b[0]} y2={t.b[1]} stroke="#15803d" strokeWidth={r / 3} />
            <text x={(t.a[0] + t.b[0]) / 2} y={(t.a[1] + t.b[1]) / 2 - r} fontSize={r * 1.6} textAnchor="middle" fill="#15803d" stroke="#fff" strokeWidth={r / 6} paintOrder="stroke">
              {formatFeetInches(t.feet)}
            </text>
          </g>
        ))}
        {shown && <line x1={shown.a[0]} y1={shown.a[1]} x2={shown.b[0]} y2={shown.b[1]} stroke="#ea580c" strokeWidth={r / 3} strokeDasharray={`${r} ${r / 2}`} />}
        {deckTaps.map((t, k) => (
          <g key={`deck-${k}`} pointerEvents="none">
            <rect x={t.x - r} y={t.y - r} width={r * 2} height={r * 2} fill="#b45309" stroke="#fff" strokeWidth={r / 5} />
            <text x={t.x} y={t.y + r * 0.42} fontSize={r * 1.1} textAnchor="middle" fill="#fff">
              {t.label}
            </text>
          </g>
        ))}
        {taps.map(({ c, i }) => (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPickTap(i);
            }}
          >
            <line
              x1={c.x}
              y1={c.party ? 0 : c.y - r * 6}
              x2={c.x}
              y2={c.y}
              stroke={selected === i ? "#ea580c" : c.party ? "#7c3aed" : "#0891b2"}
              strokeWidth={r / 4}
              strokeDasharray={c.proposed ? `${r / 1.5} ${r / 2.5}` : undefined}
            />
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={c.proposed ? "rgba(8,145,178,0.35)" : selected === i ? "#ea580c" : c.corner >= 0 ? "#0891b2" : "#78716c"}
              stroke={c.proposed ? (selected === i ? "#ea580c" : "#0891b2") : "#fff"}
              strokeWidth={r / 5}
              strokeDasharray={c.proposed ? `${r / 2} ${r / 3}` : undefined}
            />
            <text x={c.x} y={c.y + r * 0.42} fontSize={r * 1.2} textAnchor="middle" fill="#fff" stroke={c.proposed ? "#0e7490" : undefined} strokeWidth={c.proposed ? r / 8 : undefined} paintOrder="stroke">
              {c.corner >= 0 ? c.corner + 1 : "?"}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function TapeForm({ onCancel, onDone, initial = "garage" }: { onCancel: () => void; onDone: (what: TapeWhat, feet: number) => void; initial?: TapeWhat }) {
  const [what, setWhat] = useState<TapeWhat>(initial);
  const [feet, setFeet] = useState<number | null>(null);
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <button type="button" className="btn-secondary" onClick={() => onDone("garage", 9)}>
          9&prime; garage door
        </button>
        <button type="button" className="btn-secondary" onClick={() => onDone("garage", 16)}>
          16&prime; garage door
        </button>
      </div>
      <div className="option-group" role="group" aria-label="What was taped">
        {(Object.keys(WHAT_LABEL) as TapeWhat[]).map((w) => (
          <button key={w} type="button" className={`option-btn${what === w ? " selected" : ""}`} aria-pressed={what === w} onClick={() => setWhat(w)}>
            {WHAT_LABEL[w]}
          </button>
        ))}
      </div>
      <p className="field-note">{WHAT_HINT[what]}</p>
      <div className={styles.row}>
        <span>Its length </span>
        <FeetInchesInput label="Its length" onChange={setFeet} />
        <button type="button" className="btn-primary" disabled={feet === null || !(feet > 0)} onClick={() => feet && onDone(what, feet)}>
          Add the tape
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function WallTapeForm({ onCancel, onDone }: { onCancel: () => void; onDone: (feet: number) => void }) {
  const [feet, setFeet] = useState<number | null>(null);
  return (
    <div className={`${styles.card} ${styles.row}`}>
      <span>The side&rsquo;s length, corner to corner </span>
      <FeetInchesInput label="The side's length" autoFocus onChange={setFeet} />
      <button type="button" className="btn-primary" disabled={feet === null || !(feet > 0)} onClick={() => feet && onDone(feet)}>
        Add the tape
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

