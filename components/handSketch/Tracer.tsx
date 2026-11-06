"use client";

/**
 * Tracing a sketch photo (2026-11-05): tap each room's corners on the photo, name the room, type the
 * number written on each wall. A full-screen layer, phone first: the instructions and the box being
 * typed in sit at the top, so the keyboard never covers them, and the photo fills the rest, zoomed
 * 1x to 4x for a finger. A model's reading lands here too, to be checked: its corners can be moved
 * and its numbers and names changed, but none added or taken away. And so do the rooms Scrivn found in the photo
 * without AI (lib/handSketchBoxes.ts): taken one at a time, named (or joined into the room beside them when they are a
 * tub or a vanity, not a room), and their numbers typed.
 */
import { type ReactNode, useState } from "react";
import { TapPhoto, ZOOMS, type TapZoom } from "@/components/sketch/TapPhoto";
import { FeetInchesInput } from "@/components/sketch/FeetInchesInput";
import { NAMES, parseLength, type DrawnPoint } from "@/lib/handSketch";
import { joinRoom, type JoinedAs, lengthText, moveCorner, openRoom, setCeiling, setLength, setName, sharedWith, tapCorner, traceProblem, undoTap, type TraceState } from "@/lib/handSketchTrace";
import styles from "./handSketch.module.css";

type Phase =
  | { kind: "corners" }
  | { kind: "room"; room: number }
  | { kind: "walls"; room: number; wall: number }
  | { kind: "move"; from: DrawnPoint | null };

/** How near a tap must land, in CSS pixels, to count as on a corner already placed: a fingertip. */
const NEAR_CSS = 22;
/** How near a tap must land to a wall's number to pick that wall. */
const BADGE_CSS = 34;

const ROOM_NAMES = [...new Set(Object.values(NAMES))];

/** What a shape found against a room’s walls may be instead of a room: it joins the room as that fixture. */
const FIXTURES: [JoinedAs, string][] = [
  ["tub", "Tub"],
  ["shower", "Shower"],
  ["vanity", "Vanity"],
  ["toilet", "Toilet"],
];
const FIXTURE_NAMES: Record<string, string> = { tub: "Tub", shower: "Shower", vanity: "Vanity", toilet: "Toilet", sink: "Sink", cabinet: "Cabinet" };

export interface TracePhoto {
  url: string;
  width: number;
  height: number;
}

export function Tracer({
  photo,
  trace,
  onChange,
  onBack,
  onDone,
  startRoom,
  confirm,
}: {
  photo: TracePhoto;
  trace: TraceState;
  onChange: (t: TraceState) => void;
  onBack: () => void;
  /** Done, with the trace as it stands (what is in the box kept): the review builds from this. */
  onDone: (t: TraceState) => void;
  /** Open on this room's name (the first of the rooms Scrivn found). */
  startRoom?: number;
  /**
   * Scrivn has just read the sketch: go through its numbers one wall at a time, each filled in as read and lit on the
   * photo, for the person to say Right or fix, then on to the plan.
   */
  confirm?: boolean;
}) {
  // The first number Scrivn read, to start checking from.
  const firstRead = trace.rooms.findIndex((r) => r.closed && r.lengths.some((l) => !!l));
  const firstWall = firstRead >= 0 ? (trace.rooms[firstRead]?.lengths.findIndex((l) => !!l) ?? -1) : -1;
  const [phase, setPhase] = useState<Phase>(
    confirm && firstWall >= 0
      ? { kind: "walls", room: firstRead, wall: firstWall }
      : startRoom !== undefined && trace.rooms[startRoom]?.closed
        ? { kind: "room", room: startRoom }
        : { kind: "corners" },
  );
  const [zoom, setZoom] = useState<TapZoom>(photo.width > photo.height ? 2 : 1);
  const [toast, setToast] = useState<string | null>(null);
  // What a tap just did, when it is not plain on the photo (a shape joined into a room): shown until the next tap.
  const [note, setNote] = useState<string | null>(null);
  // What is in the wall's box, in feet: undefined until it is touched, so moving on keeps what was there.
  const [typed, setTyped] = useState<number | null | undefined>(undefined);
  const [otherName, setOtherName] = useState("");
  const open = openRoom(trace);
  const closedRooms = trace.rooms.filter((r) => r.closed).length;
  const corners = trace.rooms.reduce((s, r) => s + r.corners.length, 0);

  /** The next wall from [from] in [room] (stepping [dir]) not already typed in an earlier room; null past the end. */
  const nextWall = (t: TraceState, room: number, from: number, dir = 1): number | null => {
    const n = t.rooms[room]?.corners.length ?? 0;
    // Checking a reading, only the walls it read a number on: one it missed can be tapped on the photo.
    for (let w = from; w >= 0 && w < n; w += dir) if (!sharedWith(t, room, w) && (!t.locked || t.rooms[room]?.lengths[w])) return w;
    return null;
  };

  /** Keeps the box's value on its wall; returns the trace with it. */
  const keepTyped = (t: TraceState): TraceState => {
    if (phase.kind !== "walls" || typed === undefined) return t;
    return setLength(t, phase.room, phase.wall, typed === null ? null : lengthText(typed * 12));
  };

  const goWall = (t: TraceState, room: number, wall: number | null) => {
    setTyped(undefined);
    if (wall === null) {
      // This room's numbers are done: the next room found in the photo, to name; a model's next room; or back to
      // tapping the next room's corners.
      const nextFound = t.found ? t.rooms.findIndex((r, i) => i > room && r.closed) : -1;
      if (nextFound >= 0) {
        setOtherName("");
        setPhase({ kind: "room", room: nextFound });
        return;
      }
      const nextRoom = trace.locked ? t.rooms.findIndex((r, i) => i > room && r.closed && nextWall(t, i, 0) !== null) : -1;
      const first = nextRoom >= 0 ? nextWall(t, nextRoom, 0) : null;
      if (trace.locked && (nextRoom < 0 || first === null)) {
        // The last of a reading's numbers checked: on to the plan.
        onDone(t);
        return;
      }
      setPhase(nextRoom >= 0 && first !== null ? { kind: "walls", room: nextRoom, wall: first } : { kind: "corners" });
      return;
    }
    setPhase({ kind: "walls", room, wall });
  };

  const tap = (x: number, y: number, { pxPerCss }: { pxPerCss: number }) => {
    setToast(null);
    setNote(null);
    const within = NEAR_CSS * pxPerCss;
    if (phase.kind === "room") return;
    if (phase.kind === "move") {
      if (!phase.from) {
        let best: DrawnPoint | null = null;
        let gap = 1.5 * within;
        for (const p of trace.rooms.flatMap((r) => r.corners)) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d <= gap) [best, gap] = [p, d];
        }
        if (best) setPhase({ kind: "move", from: best });
        else setToast("Tap right on the corner you want to move.");
        return;
      }
      onChange(moveCorner(trace, phase.from, { x, y }, within));
      setPhase({ kind: "corners" });
      return;
    }
    if (phase.kind === "walls") {
      // A tap on a wall's number goes to that wall.
      for (const [ri, r] of trace.rooms.entries()) {
        if (!r.closed) continue;
        for (let i = 0; i < r.corners.length; i++) {
          const a = r.corners[i] as DrawnPoint;
          const b = r.corners[(i + 1) % r.corners.length] as DrawnPoint;
          if (Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y) <= BADGE_CSS * pxPerCss) {
            const kept = keepTyped(trace);
            onChange(kept);
            goWall(kept, ri, i);
            return;
          }
        }
      }
      return;
    }
    if (trace.locked) {
      setToast("Scrivn read these corners. To fix one, use Move a corner.");
      return;
    }
    const before = openRoom(trace);
    const { state, problem } = tapCorner(trace, { x, y }, within);
    if (problem === "crosses") setToast("That wall would cross another. Tap the corners in order round the room.");
    else if (problem === "tooFew") setToast("A room needs at least three corners.");
    if (state === trace) return;
    onChange(state);
    const room = state.rooms.length - 1;
    if (before && state.rooms[room]?.closed) {
      setOtherName("");
      setPhase({ kind: "room", room });
    }
  };

  const done = () => {
    const t = keepTyped(trace);
    onChange(t);
    if (openRoom(t)) return setToast("Close the room first: tap its first corner again.");
    const problem = traceProblem(t);
    if (problem === "noRoom") return setToast("Tap the corners of a room first.");
    if (problem === "noLength") return setToast("Type at least one wall's number, so the sketch has a size.");
    onDone(t);
  };

  const roomName = (i: number) => {
    const r = trace.rooms[i];
    return r?.name ?? (r?.guess ? NAMES[r.guess] : null) ?? `Room ${i + 1}`;
  };

  const overlay = (u: number) => (
    <>
      {trace.rooms.map((r, ri) => {
        const pts = r.corners;
        const n = pts.length;
        const segs = r.closed ? n : n - 1;
        return (
          <g key={ri}>
            {r.closed ? (
              <polygon
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={phase.kind === "room" && phase.room === ri ? "rgba(234,88,12,0.22)" : "rgba(37,99,235,0.10)"}
                stroke={phase.kind === "room" && phase.room === ri ? "#ea580c" : "none"}
                strokeWidth={6 * u}
              />
            ) : null}
            {Array.from({ length: Math.max(0, segs) }, (_, i) => {
              const a = pts[i] as DrawnPoint;
              const b = pts[(i + 1) % n] as DrawnPoint;
              const current = phase.kind === "walls" && phase.room === ri && phase.wall === i;
              const ang = Math.abs(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90);
              // Drawn as the build will take it: solid where it squares the wall, dashed where it keeps the angle.
              const square = Math.min(ang, 90 - ang) <= 15;
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={current ? "#ea580c" : "#2563eb"} strokeWidth={(current ? 6 : 3.5) * u} strokeDasharray={square ? undefined : `${9 * u} ${6 * u}`} strokeLinecap="round" />
              );
            })}
            {r.closed
              ? pts.map((a, i) => {
                  const b = pts[(i + 1) % n] as DrawnPoint;
                  // A wall shared with an earlier room shows that room's number; its own would sit on top of it.
                  if (!r.lengths[i] && sharedWith(trace, ri, i)) return null;
                  // Rooms Scrivn found have no numbers yet: an empty one shows only on the room being typed.
                  if (!r.lengths[i] && trace.found && !(phase.kind === "walls" && phase.room === ri)) return null;
                  const text = r.lengths[i] ?? "—";
                  const w = (text.length * 8 + 12) * u;
                  const h = 22 * u;
                  const cx = (a.x + b.x) / 2;
                  const cy = (a.y + b.y) / 2;
                  const current = phase.kind === "walls" && phase.room === ri && phase.wall === i;
                  return (
                    <g key={`b${i}`}>
                      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={5 * u} fill={current ? "#ea580c" : "#ffffff"} stroke={current ? "#ea580c" : "#2563eb"} strokeWidth={1.5 * u} />
                      <text x={cx} y={cy + 5 * u} fontSize={14 * u} textAnchor="middle" fill={current ? "#ffffff" : "#1b3a5c"} fontWeight={700}>
                        {text}
                      </text>
                    </g>
                  );
                })
              : null}
            {pts.map((p, i) => {
              const first = i === 0 && !r.closed && n >= 3;
              return <circle key={`c${i}`} cx={p.x} cy={p.y} r={(first ? 10 : 5.5) * u} fill="#ffffff" stroke={first ? "#ea580c" : "#2563eb"} strokeWidth={2.5 * u} />;
            })}
          </g>
        );
      })}
      {trace.rooms.map((r, ri) => {
        if (!r.closed) return null;
        const n = r.corners.length;
        const at = (wall: number, t: number) => {
          const a = r.corners[wall] as DrawnPoint;
          const b = r.corners[(wall + 1) % n] as DrawnPoint;
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        };
        const cx = r.corners.reduce((s, p) => s + p.x, 0) / n;
        const cy = r.corners.reduce((s, p) => s + p.y, 0) / n;
        // Doors and fixtures Scrivn saw, marked where they will go: a door on its wall, a fixture just inside its wall.
        return (
          <g key={`marks${ri}`}>
            {(r.openings ?? []).map((o, oi) => {
              if (o.wall >= n) return null;
              const p = at(o.wall, o.at);
              return (
                <g key={`o${oi}`}>
                  <circle cx={p.x} cy={p.y} r={9 * u} fill="#15803d" stroke="#ffffff" strokeWidth={2 * u} />
                  <text x={p.x} y={p.y - 13 * u} fontSize={13 * u} textAnchor="middle" fill="#14532d" fontWeight={700} stroke="#ffffff" strokeWidth={3 * u} paintOrder="stroke">
                    {o.sure ? "Door" : "Door?"}
                  </text>
                </g>
              );
            })}
            {(r.items ?? []).map((it, ii) => {
              if (it.wall >= n) return null;
              const p = at(it.wall, (it.from + it.to) / 2);
              const d = Math.hypot(cx - p.x, cy - p.y) || 1;
              const q = { x: p.x + ((cx - p.x) / d) * Math.min(it.depth / 2, d / 2), y: p.y + ((cy - p.y) / d) * Math.min(it.depth / 2, d / 2) };
              return (
                <text key={`i${ii}`} x={q.x} y={q.y} fontSize={15 * u} textAnchor="middle" fill="#14532d" fontWeight={700} stroke="#ffffff" strokeWidth={3 * u} paintOrder="stroke">
                  {FIXTURE_NAMES[it.kind] ?? it.kind}
                </text>
              );
            })}
          </g>
        );
      })}
      {phase.kind === "move" && phase.from ? <circle cx={phase.from.x} cy={phase.from.y} r={14 * u} fill="none" stroke="#ea580c" strokeWidth={3.5 * u} /> : null}
    </>
  );

  let strip: ReactNode;
  if (phase.kind === "room") {
    const r = trace.rooms[phase.room];
    const notARoom = (as: JoinedAs | null) => {
      const joined = joinRoom(trace, phase.room, as);
      if (!joined) return setToast("That shape shares no wall with a room, so it cannot be joined into one. Tap Next to keep it as a room.");
      onChange(joined.state);
      const what = as ? FIXTURE_NAMES[as] : "It";
      setNote(`${what} joined into the room beside it${as ? " as a fixture" : ""}.`);
      setOtherName("");
      // The rooms after it have moved up one: the next to name is at the same place (the room it joined, too, when
      // that is still to come), if any is left there.
      const next = joined.state.rooms.findIndex((o, i) => i >= phase.room && o.closed);
      setPhase(next >= 0 ? { kind: "room", room: next } : { kind: "corners" });
    };
    // Kept short, so the room lit up on the photo below stays in sight on a phone: the names in one row to swipe.
    strip = (
      <>
        <p className={styles.say}>
          <strong>{trace.found ? `Room ${phase.room + 1} of ${closedRooms}, in orange: what is it?` : "What is this room?"}</strong>
        </p>
        {trace.found && closedRooms > 1 ? (
          <div key={`fixtures${phase.room}`} className={`${styles.chips} ${styles.chipsScroll}`}>
            <span className={styles.chipLabel}>Not a room:</span>
            {FIXTURES.map(([kind, label]) => (
              <button key={kind} type="button" className="option-btn" onClick={() => notARoom(kind)}>
                {label}
              </button>
            ))}
            <button type="button" className="option-btn" onClick={() => notARoom(null)}>
              Something else
            </button>
          </div>
        ) : null}
        <div key={`names${phase.room}`} className={`${styles.chips} ${styles.chipsScroll}`}>
          {ROOM_NAMES.map((name) => (
            <button key={name} type="button" className={`option-btn${r?.name === name ? " selected" : ""}`} aria-pressed={r?.name === name} onClick={() => onChange(setName(trace, phase.room, name))}>
              {name}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <input type="text" aria-label="Another name" placeholder="Another name" value={otherName} onChange={(e) => setOtherName(e.target.value)} style={{ fontSize: 16, minHeight: 40, flex: "1 1 8rem" }} />
          <button type="button" className="btn-secondary" disabled={!otherName.trim()} onClick={() => onChange(setName(trace, phase.room, otherName))}>
            Use name
          </button>
        </div>
        <div className={styles.wallEntry}>
          <span>Ceiling, if written:</span>
          <FeetInchesInput key={`ceil${phase.room}`} label="Ceiling height" initial={r?.ceiling ? (parseLength(r.ceiling) ?? 0) / 12 : null} onChange={(feet) => onChange(setCeiling(trace, phase.room, feet === null ? null : lengthText(feet * 12)))} />
          <button type="button" className="btn-primary" onClick={() => goWall(trace, phase.room, nextWall(trace, phase.room, 0))}>
            Next: the walls
          </button>
        </div>
      </>
    );
  } else if (phase.kind === "walls") {
    const r = trace.rooms[phase.room];
    const n = r?.corners.length ?? 0;
    const current = r?.lengths[phase.wall] ?? null;
    strip = (
      <>
        <p className={styles.say}>
          <strong>
            {roomName(phase.room)}: wall {phase.wall + 1} of {n}.
          </strong>{" "}
          {trace.locked ? (
            current ? (
              <>
                Scrivn read <strong>{current}</strong> on the orange wall. Right? If not, fix it.
              </>
            ) : (
              "Scrivn read no number on the orange wall. Type it if one is written, or Skip."
            )
          ) : (
            "Type the number written on it (the orange one), or Skip if there is none."
          )}
        </p>
        <div className={styles.wallEntry}>
          {/* A number read to confirm opens no keyboard: Right is one tap. */}
          <FeetInchesInput key={`${phase.room}:${phase.wall}`} label={`Wall ${phase.wall + 1}`} autoFocus={!(trace.locked && current)} initial={current ? (parseLength(current) ?? 0) / 12 : null} onChange={(feet) => setTyped(feet)} />
        </div>
        <div className={styles.row}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const kept = keepTyped(trace);
              onChange(kept);
              goWall(kept, phase.room, nextWall(kept, phase.room, phase.wall + 1));
            }}
          >
            {trace.locked && current && typed === undefined ? "Right" : "Next"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const kept = setLength(trace, phase.room, phase.wall, null);
              onChange(kept);
              goWall(kept, phase.room, nextWall(kept, phase.room, phase.wall + 1));
            }}
          >
            {trace.locked && current ? "No number here" : "Skip"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={nextWall(trace, phase.room, phase.wall - 1, -1) === null}
            onClick={() => {
              const kept = keepTyped(trace);
              onChange(kept);
              goWall(kept, phase.room, nextWall(kept, phase.room, phase.wall - 1, -1));
            }}
          >
            Back
          </button>
        </div>
      </>
    );
  } else if (phase.kind === "move") {
    strip = (
      <>
        <p className={styles.say}>
          <strong>{phase.from ? "Now tap where the corner goes." : "Tap the corner to move."}</strong> A corner two rooms share moves for both.
        </p>
        <div className={styles.row}>
          <button type="button" className="btn-secondary" onClick={() => setPhase({ kind: "corners" })}>
            Cancel
          </button>
        </div>
      </>
    );
  } else {
    strip = (
      <>
        <p className={`${styles.say} ${styles.sayFixed}`}>
          {trace.locked ? (
            <>
              <strong>
                Scrivn read {closedRooms} room{closedRooms === 1 ? "" : "s"}.
              </strong>{" "}
              Check the corners and numbers against your drawing, then Done.
            </>
          ) : trace.found && !open ? (
            <>
              <strong>
                Scrivn found {closedRooms} room{closedRooms === 1 ? "" : "s"}.
              </strong>{" "}
              Done when the numbers are in. A room it missed: tap its corners. A corner in the wrong place: Move a corner.
            </>
          ) : open ? (
            <>
              <strong>Room {trace.rooms.length}: tap its corners in order.</strong> Tap the first corner again to close it.
            </>
          ) : closedRooms ? (
            <>
              <strong>Tap the first corner of the next room</strong>, or Done. A corner a room shares with one already traced: tap right on it.
            </>
          ) : (
            <>
              <strong>Tap the first corner of a room</strong>, then each corner in order round it.
            </>
          )}
        </p>
        <div className={styles.row}>
          {!trace.locked && (!trace.found || open) ? (
            <button type="button" className="btn-secondary" disabled={corners === 0} onClick={() => onChange(undoTap(trace))}>
              Undo
            </button>
          ) : null}
          <button type="button" className="btn-secondary" disabled={corners === 0} onClick={() => setPhase({ kind: "move", from: null })}>
            Move a corner
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={closedRooms === 0}
            onClick={() => {
              const room = trace.rooms.findIndex((r) => r.closed);
              goWall(trace, room, nextWall(trace, room, 0));
            }}
          >
            Numbers
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={styles.layer} role="dialog" aria-label="Trace your sketch">
      <div className={styles.bar}>
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        <p className={styles.barTitle}>Trace your sketch</p>
        <button type="button" className="btn-primary" onClick={done}>
          Done
        </button>
      </div>
      <div className={styles.strip}>{strip}</div>
      <div className={styles.photoArea}>
        {toast ? (
          <p className={styles.toast} role="status">
            {toast}
          </p>
        ) : note ? (
          <p className={`${styles.toast} ${styles.toastOk}`} role="status">
            {note}
          </p>
        ) : null}
        <div className={styles.zooms} role="group" aria-label="Show the photo larger">
          {ZOOMS.map((z) => (
            <button key={z} type="button" className={`option-btn${zoom === z ? " selected" : ""}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z}x
            </button>
          ))}
        </div>
        <TapPhoto info={{ url: photo.url, width: photo.width, height: photo.height, label: "Your sketch" }} active head={false} fill zoom={zoom} onZoom={setZoom} onTap={tap} overlay={overlay} />
      </div>
    </div>
  );
}
