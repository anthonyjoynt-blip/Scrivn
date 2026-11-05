"use client";

import { useState } from "react";
import styles from "./PhotoRoute.module.css";
import { TapPhoto, type TapPhotoInfo } from "./TapPhoto";

type Pair = { d: [number, number] | null; f: [number, number] | null };

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
