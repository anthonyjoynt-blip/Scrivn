"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PhotoRouteState, RoutePhoto, TapeWhat } from "@/lib/photoRoute";
import {
  lapCloses,
  lapOutline,
  lapTurns,
  measureWords,
  newMeasureId,
  newWalk,
  type RingItem,
  ringItems,
  type RouteWalk,
  walkAddCorner,
  walkAddMeasure,
  walkAddPhoto,
  walkFinish,
  walkHasMeasure,
  type WalkMeasure,
  walkMeasures,
  walkMissing,
  walkRemoveLastCorner,
  walkRemoveMeasure,
  walkRemovePhoto,
  walkReopen,
  walkSummary,
  type WalkTurn,
  withoutPhotos,
  withRingStart,
  withWalk,
} from "@/lib/photoRouteWalk";
import type { Pt } from "@/lib/roof";
import { FeetInchesInput } from "./FeetInchesInput";
import styles from "./PhotoRoute.module.css";
import { WHAT_HINT, WHAT_LABEL } from "./photoRouteParts";

/**
 * The walk round the house as a ring to fill in, in any order (2026-10-22, lib/photoRouteWalk.ts): the photo route's way in,
 * sized for a phone held at the house. The house's walls and corners in a ring - the front, then each corner as it's said
 * and the wall after it - each ticking off as its photos come in; tap one to put photos on it, more than one where a wall
 * is long or broken up. "Add a measurement" is there all along, for any wall, with a photo of the tape if there's one.
 * Finish is there all along too, with what is still missing said. Then Send to Scrivn team, or measure it here.
 *
 * The owner, after the step-by-step walk: "the elevations around the back deck are tough and i might need to get pictures
 * above and/or below the deck ... when i was taking a picture of the AC side i had to go around that fence to get it, then
 * back around to get the measurement, then back around to get the corner photo". Nothing is drawn on a photo here.
 *
 * Every change is kept on the route as it is made (`PhotoRouteState.walk`), and each photo is a claim photo like any other,
 * so a walk half done waits on the phone through a reload or no signal.
 */

type RouteChange = (f: (route: PhotoRouteState) => PhotoRouteState) => void;

/** A side too tight to step back from (2026-10-21, as Hover asks): upright before giving up on it. */
const UPRIGHT = "No room to step back? Turn the phone upright, still on the 1x lens, to get the wall in top to bottom.";

const ON_A_WALL: TapeWhat[] = ["garage", "window", "door", "wall"];

/** The route's walk changed, its photos' tags and (finished, closing) the shape with it. */
const walked = (r: PhotoRouteState, f: (w: RouteWalk) => RouteWalk): PhotoRouteState => withWalk(r, f(withRingStart(r.walk ?? newWalk())));

/** What to take of a wall or corner, said where it's tapped. */
function tipFor(item: RingItem): string {
  if (item.kind === "wall") {
    if (item.k === 0) return "Stand back across from the front, straight on, so all of it is in: both front corners, the ground and the roof edge. More of it as well where it's long or stepped.";
    return `Straight on, the whole wall if you can: both its corners, the ground and the roof edge. Long, or broken up by a deck? Take it in parts as well: above or below the deck is fine. ${UPRIGHT}`;
  }
  if (item.auto) return "Stand out at an angle from where your home meets the neighbour's, so the whole open wall on from here is in, both its ends.";
  if (item.turn === "joined") return "No 45° photo here: the neighbour's home is in the way. Stand out at an angle from where your home meets the neighbour's, so the whole wall up to here is in, both its ends.";
  if (item.turn === "inside") return "No photo needed: the walls either side show an inside corner. If the wall before it had no room for a photo of its own, take that wall from wherever you can, this corner in it.";
  return "Step back from the corner until both whole walls fit, with the far corner of each in the photo too: three corners in all, this one near the middle, about 45° to both walls. The ground and the roof edge in.";
}

export function PhotoWalk({
  route,
  urls,
  readOnly,
  the,
  change,
  keep,
  checkpoint,
  onOwnWay,
  send,
  onMeasureHere,
}: {
  route: PhotoRouteState;
  urls: Map<string, string>;
  readOnly: boolean;
  /** "the house", or "the shed". */
  the: string;
  change: RouteChange;
  /** A photo file kept as one of the claim's Exterior photos: its place on the route, not yet added. Null if it could not be kept. */
  keep: (file: File) => Promise<RoutePhoto | null>;
  /** The claim saved now (a change is kept at once). */
  checkpoint: () => void;
  /** "Add photos my own way": the route as it was before the walk. */
  onOwnWay: () => void;
  /** Send to Scrivn team (TeamMeasure.tsx), for the end of the walk. */
  send: ReactNode;
  /** "Measure it here": on to tapping the corners on each photo. */
  onMeasureHere: () => void;
}) {
  const walk = withRingStart(route.walk ?? newWalk());
  const items = ringItems(walk);
  const [busy, setBusy] = useState(false);
  /** The wall or corner open below its row, by its stop. */
  const [open, setOpen] = useState<number | null>(null);
  /** "Add a measurement" open: on which wall, once picked (null: not yet). */
  const [measuring, setMeasuring] = useState<{ stop: number | null } | null>(null);
  // A photo just taken, shown from its own file at once: the pane's copy comes from the phone's store a moment later.
  const [fresh, setFresh] = useState<Map<string, string>>(new Map());
  const made = useRef<string[]>([]);
  useEffect(() => () => made.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const urlOf = (id: string) => urls.get(id) ?? fresh.get(id) ?? null;
  const showNow = (id: string, file: File) => {
    const u = URL.createObjectURL(file);
    made.current.push(u);
    setFresh((m) => new Map(m).set(id, u));
  };

  const act = (f: (r: PhotoRouteState) => PhotoRouteState) => {
    change(f);
    checkpoint();
  };

  /** Photos put on a wall or corner: each kept as a claim photo, then on the route and the ring. */
  async function take(stop: number, files: FileList | null) {
    const list = [...(files ?? [])];
    if (list.length === 0 || busy) return;
    setBusy(true);
    const got: RoutePhoto[] = [];
    for (const file of list) {
      const p = await keep(file);
      if (p) {
        showNow(p.id, file);
        got.push(p);
      }
    }
    setBusy(false);
    if (got.length) act((r) => walked({ ...r, photos: [...r.photos, ...got] }, (w) => got.reduce((x, p) => walkAddPhoto(x, stop, p.id), w)));
  }

  /** A close-up of a tape: a claim photo only, never one of the route's. */
  async function keepTape(files: FileList | null): Promise<string | null> {
    const file = files?.[0];
    if (!file) return null;
    setBusy(true);
    const p = await keep(file);
    setBusy(false);
    if (!p) return null;
    showNow(p.id, file);
    return p.id;
  }

  const takeOut = (photo: string) => act((r) => withWalk(withoutPhotos(r, [photo]), walkRemovePhoto(withRingStart(r.walk ?? newWalk()), photo)));
  const addCorner = (t: WalkTurn) => {
    act((r) => walked(r, (w) => walkAddCorner(w, t)));
    setOpen(null);
  };
  const removeCorner = () =>
    act((r) => {
      const { walk: w, dropped } = walkRemoveLastCorner(withRingStart(r.walk ?? newWalk()));
      return withWalk(withoutPhotos(r, dropped), w);
    });
  const addMeasure = (stop: number, m: Omit<WalkMeasure, "id">) => {
    act((r) => walked(r, (w) => walkAddMeasure(w, stop, { ...m, id: newMeasureId() })));
    setMeasuring(null);
  };
  const removeMeasure = (id: string) =>
    act((r) => {
      const next = walked(r, (w) => walkRemoveMeasure(w, id));
      // A line already placed for it goes with it.
      return { ...next, buildings: next.buildings.map((b) => (b.id === "main" ? { ...b, tapes: b.tapes.filter((t) => t.id !== id) } : b)) };
    });

  const takeButtons = (stop: number, label: string) =>
    readOnly ? null : (
      <div className={styles.walkTake}>
        <label className={`btn-primary ${styles.walkBig}`} aria-disabled={busy}>
          {busy ? "Keeping the photo…" : label}
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => void take(stop, e.target.files).then(() => (e.target.value = ""))} />
        </label>
        <label className="link-button">
          or choose from the gallery
          <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => void take(stop, e.target.files).then(() => (e.target.value = ""))} />
        </label>
      </div>
    );

  const measurePanel = measuring && !readOnly && (
    <MeasurePanel
      walls={items.filter((i) => i.kind === "wall" && !i.shared)}
      stop={measuring.stop}
      onStop={(stop) => setMeasuring({ stop })}
      photoOf={(stop) => route.photos.find((p) => p.id === walk.stops[stop]?.photos[0]) ?? null}
      urlOf={urlOf}
      keepTape={keepTape}
      busy={busy}
      onAdd={addMeasure}
      onCancel={() => setMeasuring(null)}
    />
  );

  if (walk.closed) {
    // The end of the walk.
    const sum = walkSummary(route);
    const closes = lapCloses(walk);
    const main = route.buildings.find((b) => b.id === "main");
    const label = new Map(items.map((i) => [i.stop, i.label]));
    const typed = walkMeasures(walk);
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        <div className={styles.walkHead}>
          <span className="field-note">Finished</span>
          <h3>Round {the}: done</h3>
        </div>
        <p>
          {sum.photos} photo{sum.photos === 1 ? "" : "s"}, {sum.corners} corner{sum.corners === 1 ? "" : "s"}
          {sum.inside || sum.joined ? ` (${[sum.inside ? `${sum.inside} inside` : "", sum.joined ? `${sum.joined} at the neighbour's` : ""].filter(Boolean).join(", ")})` : ""}, {sum.measures} measurement
          {sum.measures === 1 ? "" : "s"}.
        </p>
        {typed.length > 0 && <p className="field-note">Measured: {typed.map(({ m, stop }) => `${measureWords(m)} (${(label.get(stop) ?? "a wall").replace(/^The /, "the ")})`).join("; ")}.</p>}
        {closes ? (
          <>
            <RingSketch walk={walk} outline={main?.outline} selected={null} />
            <p className="field-note">The shape your corners make. Its sizes are rough until it&rsquo;s measured: the photos and your measurements set them.</p>
          </>
        ) : (
          <p className="field-note">The corners don&rsquo;t close round to the front, so the shape isn&rsquo;t drawn from them: draw it below, or the Scrivn team will.</p>
        )}
        {!walkHasMeasure(route) && <p className={styles.ask}>No measurement yet: one sets the scale for everything. The Scrivn team can scale off a tape in a photo, if there&rsquo;s one.</p>}
        {!readOnly && !measuring && (
          <button type="button" className="btn-secondary" onClick={() => setMeasuring({ stop: null })}>
            Add a measurement
          </button>
        )}
        {measurePanel}
        {!readOnly && (
          <>
            <p className={styles.walkSay}>Send it to the Scrivn team: they place each measurement on its photo exactly, and measure {the}.</p>
            <div className={styles.walkNext}>{send}</div>
            <p className="field-note">
              Or measure it here: tap the corners on each photo, and drag each measurement&rsquo;s line across it on its photo. That part is easiest on a computer or a tablet: on a
              phone the photos are small.
            </p>
            <div className={styles.row}>
              <button type="button" className="btn-secondary" onClick={onMeasureHere}>
                Measure it here
              </button>
            </div>
            <div className={styles.walkFoot}>
              <button type="button" className="link-button" onClick={() => act((r) => walked(r, walkReopen))}>
                Back to the walk
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const missing = walkMissing(route);
  const lastCorner = [...items].reverse().find((i) => i.kind === "corner" && !i.auto);
  return (
    <div className={`${styles.card} ${styles.walk}`}>
      <div className={styles.walkHead}>
        <span className="field-note">Round {the}, in any order</span>
        <h3>Photos of every wall and corner</h3>
      </div>
      <p>
        Photograph every wall straight on and every corner you can, in any order: more than one where a wall is long or broken up (above or below a deck is fine). Measure at least
        one thing for scale, ideally one on each wall. Normal 1x camera, held sideways.
      </p>
      <RingSketch walk={walk} outline={lapCloses(walk) ? (lapOutline(lapTurns(walk)) ?? undefined) : undefined} selected={open} />
      <ul className={styles.ring}>
        {items.map((item) => {
          const done = item.shared || item.photos > 0 || (item.kind === "corner" && item.turn === "inside");
          const isOpen = open === item.stop;
          const photos = walk.stops[item.stop]?.photos ?? [];
          const measures = walk.stops[item.stop]?.measures ?? [];
          return (
            <li key={item.stop} className={isOpen ? styles.ringOpen : undefined}>
              <button type="button" className={styles.ringRow} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.stop)} disabled={item.shared}>
                <span className={done ? styles.ringDone : styles.ringTodo} aria-hidden>
                  {done ? "✓" : ""}
                </span>
                <span className={styles.ringLabel}>{item.label}</span>
                <span className="field-note">
                  {item.shared ? "no photo" : `${item.photos} photo${item.photos === 1 ? "" : "s"}${item.measures ? ` · ${item.measures} measured` : ""}`}
                </span>
              </button>
              {isOpen && (
                <div className={styles.ringDetail}>
                  <p className="field-note">{tipFor(item)}</p>
                  {photos.length > 0 && (
                    <div className={styles.thumbs}>
                      {photos.map((id) => (
                        <span key={id} className={styles.ringThumb}>
                          {urlOf(id) ? <img src={urlOf(id) as string} alt="" /> : <span className="field-note">waiting</span>}
                          {!readOnly && (
                            <button type="button" className="link-button" onClick={() => takeOut(id)}>
                              Take out
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {takeButtons(item.stop, photos.length ? (item.kind === "wall" ? "Take more of this wall" : "Take another") : "Take a photo of it")}
                  {item.kind === "wall" && (
                    <>
                      <MeasureList items={measures} readOnly={readOnly} onRemove={removeMeasure} />
                      {!readOnly && (
                        <button type="button" className="link-button" onClick={() => setMeasuring({ stop: item.stop })}>
                          Add a measurement on this wall
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <div className={styles.ringAdd}>
          <span>Next corner round, with the house on your left:</span>
          <div className="option-group" role="group" aria-label="Add the next corner">
            <button type="button" className="option-btn" onClick={() => addCorner("outside")}>
              + Outside corner
            </button>
            <button type="button" className="option-btn" onClick={() => addCorner("inside")}>
              + Inside corner
            </button>
            <button type="button" className="option-btn" onClick={() => addCorner("joined")}>
              + Joins the neighbour
            </button>
          </div>
          <p className="field-note">
            Corner 1 is the front&rsquo;s right-hand end. Outside: it sticks out towards you. Inside: tucked in, two walls meeting in a notch. Joins the neighbour: your home meets
            the neighbour&rsquo;s there, and the wall on from it is shared.
          </p>
          {lastCorner && (
            <button type="button" className="link-button" onClick={removeCorner}>
              Take back {lastCorner.label.toLowerCase()}
            </button>
          )}
        </div>
      )}
      {!readOnly && !measuring && (
        <button type="button" className={`btn-secondary ${styles.walkBig}`} onClick={() => setMeasuring({ stop: null })}>
          Add a measurement
        </button>
      )}
      {measurePanel}
      {missing && <p className={styles.ask}>{missing}</p>}
      {!readOnly && (
        <div className={styles.walkNext}>
          <button type="button" className={`${missing ? "btn-secondary" : "btn-primary"} ${styles.walkBig}`} onClick={() => act((r) => walked(r, walkFinish))}>
            Finish
          </button>
        </div>
      )}
      {!readOnly && (
        <div className={styles.walkFoot}>
          <button type="button" className="link-button" onClick={onOwnWay}>
            Add photos my own way
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Add a measurement", any time (2026-10-22): which wall, what it is and its size, and a close-up of the tape on it if there
 * is one. Not tied to the photo just taken; its place on a photo can come later, on a bigger screen, or from the Scrivn team.
 */
function MeasurePanel({
  walls,
  stop,
  onStop,
  photoOf,
  urlOf,
  keepTape,
  busy,
  onAdd,
  onCancel,
}: {
  walls: RingItem[];
  stop: number | null;
  onStop: (stop: number) => void;
  photoOf: (stop: number) => RoutePhoto | null;
  urlOf: (id: string) => string | null;
  keepTape: (files: FileList | null) => Promise<string | null>;
  busy: boolean;
  onAdd: (stop: number, m: Omit<WalkMeasure, "id">) => void;
  onCancel: () => void;
}) {
  const [tape, setTape] = useState<string | null>(null);
  const photo = stop === null ? null : photoOf(stop);
  return (
    <div className={styles.walkMeasurePanel}>
      <strong>Add a measurement</strong>
      <p className="field-note">Which wall is it on?</p>
      <div className="option-group" role="group" aria-label="Which wall">
        {walls.map((w) => (
          <button key={w.stop} type="button" className={`option-btn${stop === w.stop ? " selected" : ""}`} aria-pressed={stop === w.stop} onClick={() => onStop(w.stop)}>
            {w.label.replace(/^The /, "")}
          </button>
        ))}
      </div>
      {stop !== null && (
        <MeasureForm
          key={stop}
          photo={photo}
          url={photo ? urlOf(photo.id) : null}
          kinds={ON_A_WALL}
          onAdd={(m) => onAdd(stop, { ...m, ...(tape ? { tapePhoto: tape } : {}) })}
          onCancel={onCancel}
          extra={
            <div className={styles.walkTape}>
              {tape ? (
                <span className={styles.ringThumb}>
                  {urlOf(tape) ? <img src={urlOf(tape) as string} alt="The tape" /> : null}
                  <button type="button" className="link-button" onClick={() => setTape(null)}>
                    Take out
                  </button>
                </span>
              ) : (
                <label className="btn-secondary" aria-disabled={busy}>
                  {busy ? "Keeping the photo…" : "Photo of the tape on it"}
                  <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => void keepTape(e.target.files).then((id) => (setTape(id), (e.target.value = "")))} />
                </label>
              )}
              <span className="field-note">If you can, close up, the number and both ends of the tape in it: the most useful photo of all.</span>
            </div>
          }
        />
      )}
      {stop === null && (
        <button type="button" className={`link-button ${styles.walkCancel}`} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const dirOf = (h: number) => DIRS[((h % 4) + 4) % 4] as [number, number];

/**
 * The ring drawn small: the front at the bottom, each corner said round from its right-hand end, numbered, rough sizes (the
 * corners say the turns, not the sizes). A wall or corner with a photo solid, one without dashed or hollow; the one open
 * below in orange. Once the corners close, the shape they make.
 */
function RingSketch({ walk, outline, selected }: { walk: RouteWalk; outline?: Pt[]; selected: number | null }) {
  const turns = lapTurns(walk);
  const corners = walk.stops.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "corner");
  // The walls by stop: front from point 0 to 1; the wall after corner k from point k to k + 1.
  const closed = !!outline && outline.length === turns.length && turns.length >= 4;
  let pts: Pt[];
  if (closed) {
    // Outline corner k - 1 is corner k; the front runs from the last corner round to corner 1.
    pts = [outline[outline.length - 1] as Pt, ...outline];
  } else {
    pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
    let h = 0;
    for (let k = 1; k <= turns.length; k++) {
      h += turns[k - 1] as number;
      const short = turns[k - 1] === -1 || turns[k] === -1;
      const L = k === turns.length ? 18 : short ? 12 : h % 2 === 0 ? 40 : 30;
      const [dx, dy] = dirOf(h);
      const p = pts[pts.length - 1] as Pt;
      pts.push({ x: p.x + dx * L, y: p.y + dy * L });
    }
  }
  const wallStops = walk.stops.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== "corner");
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y1 = Math.max(...ys);
  const span = Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys), 30);
  const pad = span * 0.1;
  const W = Math.max(...xs) - x0 + 2 * pad;
  const H = y1 - Math.min(...ys) + 2 * pad;
  const P = (p: Pt) => ({ x: p.x - x0 + pad, y: y1 - p.y + pad });
  const r = span * 0.035;
  const segs = wallStops.slice(0, pts.length - 1).map(({ s, i }, n) => ({ s, i, a: P(pts[n] as Pt), b: P(pts[n + 1] as Pt) }));
  return (
    <svg className={styles.walkPlan} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The walls and corners so far: done solid, still to take dashed">
      {closed && <polygon points={pts.slice(1).map((p) => `${P(p).x},${P(p).y}`).join(" ")} fill="rgba(8,145,178,0.08)" stroke="none" />}
      {segs.map(({ s, i, a, b }) => (
        <line
          key={`w${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={selected === i ? "#ea580c" : s.shared ? "#a8a29e" : s.photos.length ? "#0891b2" : "#94a3b8"}
          strokeWidth={span * (s.kind === "front" || selected === i ? 0.022 : 0.014)}
          strokeDasharray={s.photos.length || s.shared ? undefined : `${r} ${r * 0.7}`}
          strokeLinecap="round"
        />
      ))}
      <text x={(P(pts[0] as Pt).x + P(pts[1] as Pt).x) / 2} y={P(pts[0] as Pt).y + r * 2.4} fontSize={r * 1.3} textAnchor="middle" fill="#0e7490">
        front
      </text>
      {corners.map(({ s, i }, n) => {
        const c = P(pts[n + 1] as Pt);
        const has = s.photos.length > 0 || s.turn === "inside";
        return (
          <g key={`c${i}`}>
            <circle cx={c.x} cy={c.y} r={r} fill={selected === i ? "#ea580c" : has ? "#0891b2" : "#ffffff"} stroke={selected === i ? "#ea580c" : "#0891b2"} strokeWidth={r * 0.25} />
            <text x={c.x} y={c.y + r * 0.42} fontSize={r * 1.15} textAnchor="middle" fill={has || selected === i ? "#ffffff" : "#0891b2"}>
              {n + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MeasureList({ items, readOnly, onRemove }: { items: WalkMeasure[]; readOnly: boolean; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.walkMeasured}>
      {items.map((m) => (
        <li key={m.id}>
          <strong>{measureWords(m)}</strong>
          <span className="field-note">{m.tapePhoto ? " with a photo of the tape" : ""}</span>
          {!readOnly && (
            <button type="button" className="link-button" onClick={() => onRemove(m.id)}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One measurement, typed: what it was, its size (a garage door's 9' or 16' one tap, else feet, inches and an eighth), and -
 * if they like - one tap on the photo roughly on it. No line to drag (the first walk's was "borderline impossible" on a phone).
 */
function MeasureForm({
  photo,
  url,
  kinds,
  onAdd,
  onPicking,
  onCancel,
  extra,
}: {
  photo: RoutePhoto | null;
  url: string | null;
  kinds: TapeWhat[];
  onAdd: (m: Omit<WalkMeasure, "id">) => void;
  /** What it is picked (true) or unpicked: the card's "No, nothing measured here" stands aside meanwhile. */
  onPicking?: (picking: boolean) => void;
  /** Shown as Cancel beside the form when there's somewhere to go back to (something measured here already). */
  onCancel?: () => void;
  /** Above Add it, once what it is is picked: the close-up of the tape (2026-10-22). */
  extra?: ReactNode;
}) {
  const [what, setWhat] = useState<TapeWhat | null>(kinds.length === 1 ? (kinds[0] as TapeWhat) : null);
  const [chip, setChip] = useState<number | null>(null);
  const [typed, setTyped] = useState<number | null>(null);
  /** The boxes cleared when a garage door size is tapped, and the other way round. */
  const [boxes, setBoxes] = useState(0);
  const [near, setNear] = useState<[number, number] | null>(null);
  const feet = chip ?? typed;
  const pick = (w: TapeWhat | null) => {
    setWhat(w);
    setChip(null);
    setTyped(null);
    setNear(null);
    setBoxes((n) => n + 1);
    if (kinds.length > 1) onPicking?.(w !== null);
  };
  return (
    <div className={styles.walkForm}>
      {kinds.length > 1 && (
        <div className="option-group" role="group" aria-label="What you measured">
          {kinds.map((k) => (
            <button key={k} type="button" className={`option-btn${what === k ? " selected" : ""}`} aria-pressed={what === k} onClick={() => pick(k)}>
              {WHAT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {what && (
        <>
          <p className="field-note">{what === "wall" ? "The whole wall, corner to corner." : WHAT_HINT[what]}</p>
          {what === "garage" && (
            <div className={styles.row} role="group" aria-label="The garage door's width">
              {[9, 16].map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`option-btn${chip === f ? " selected" : ""}`}
                  aria-pressed={chip === f}
                  onClick={() => {
                    setChip(f);
                    setTyped(null);
                    setBoxes((n) => n + 1);
                  }}
                >
                  {f}&prime; door
                </button>
              ))}
              <span className="field-note">or type it:</span>
            </div>
          )}
          <FeetInchesInput
            key={`${what}-${boxes}`}
            label={what === "garage" ? "Its width" : what === "wall" ? "The wall's length" : "Its size"}
            onChange={(f) => {
              setTyped(f);
              if (f !== null) setChip(null);
            }}
          />
          {photo && what !== "wall" && (
            <>
              <p className="field-note">If you like, tap it on the photo, roughly. Close is fine: we place it exactly.</p>
              <NearTap url={url} width={photo.width} height={photo.height} near={near} onTap={setNear} />
            </>
          )}
          {extra}
          <button type="button" className={`btn-primary ${styles.walkBig}`} disabled={!(feet !== null && feet > 0)} onClick={() => feet && onAdd({ what, feet, ...(photo ? { photo: photo.id } : {}), ...(near && what !== "wall" ? { near } : {}) })}>
            {feet ? `Add it: ${measureWords({ what, feet })}` : "Add it"}
          </button>
        </>
      )}
      {(onCancel || (what && kinds.length > 1)) && (
        <button type="button" className={`link-button ${styles.walkCancel}`} onClick={() => (onCancel ? onCancel() : pick(null))}>
          Cancel
        </button>
      )}
    </div>
  );
}

/**
 * The photo, a tap on it marking roughly where: one tap, no drag, so a swipe still scrolls the page past it. The mark is
 * where to look for what was measured, never its ends.
 */
function NearTap({ url, width, height, near, onTap }: { url: string | null; width: number; height: number; near: [number, number] | null; onTap: (p: [number, number]) => void }) {
  return (
    <div
      className={styles.nearBox}
      // Waiting for its picture, the box keeps the photo's shape across the card rather than shrinking to nothing.
      style={url ? undefined : { width: "100%" }}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        onTap([Math.round(((e.clientX - box.left) / box.width) * width), Math.round(((e.clientY - box.top) / box.height) * height)]);
      }}
    >
      {url ? <img src={url} alt="The photo: tap roughly on what you measured" draggable={false} /> : <div style={{ width: "100%", aspectRatio: `${width} / ${height}`, background: "#e7e5e4" }} />}
      {near && <span className={styles.nearMark} style={{ left: `${(near[0] / width) * 100}%`, top: `${(near[1] / height) * 100}%` }} aria-hidden />}
    </div>
  );
}
