"use client";

import { type ReactNode, useState } from "react";
import { HOME_TYPE_LABEL, type HomeType, isAttachedHome } from "@/lib/exterior";
import { defaultShared, type PhotoRouteState, type RouteBuilding, type RoutePhoto, type RouteTape, type TapeWhat } from "@/lib/photoRoute";
import {
  facingWords,
  insideWalls,
  lapCloses,
  lapOutline,
  lapProblem,
  lapTurns,
  newWalk,
  type RouteWalk,
  walkBack,
  walkClose,
  walkHasMeasure,
  walkHeading,
  walkMeasured,
  walkPhotos,
  walkPhotoWords,
  walkSharedSides,
  walkSkip,
  walkStep,
  type WalkStep,
  walkSummary,
  walkTake,
  type WalkTurn,
  walkTurn,
  withoutPhotos,
  withWalk,
} from "@/lib/photoRouteWalk";
import type { Pt } from "@/lib/roof";
import styles from "./PhotoRoute.module.css";
import { PhotoTaps, TapeForm } from "./photoRouteParts";

/**
 * The walk round the house (2026-10-21, lib/photoRouteWalk.ts): the photo route's way in, one card at a time, sized for a
 * phone held at the house. The front, something on it measured; then round the house from the front's right-hand corner:
 * each corner at 45 degrees (an inside corner: the walls either side), each side straight on if there's room, something on
 * it measured if there's something; until back where it started. Then Send to Scrivn team, or measure it here.
 *
 * Every step is kept on the route as it is taken (`PhotoRouteState.walk`), and each photo is a claim photo like any other,
 * so a walk half done waits on the phone through a reload or no signal and picks up at the step it was on.
 */

type RouteChange = (f: (route: PhotoRouteState) => PhotoRouteState) => void;

/** A side too tight to step back from (2026-10-21, as Hover asks): upright before giving up on it. */
const UPRIGHT = "No room to step back? Turn the phone upright, still on the 1x lens, to get the wall in top to bottom. Only if it still won't fit: Can't get back far enough.";

const emptyMain = (): RouteBuilding => ({ id: "main", outline: [], corners: [], tapes: [] });
const mainOf = (r: PhotoRouteState): RouteBuilding => r.buildings.find((b) => b.id === "main") ?? emptyMain();
const withMain = (r: PhotoRouteState, f: (b: RouteBuilding) => RouteBuilding): PhotoRouteState => {
  const b = f(mainOf(r));
  return { ...r, buildings: r.buildings.some((x) => x.id === "main") ? r.buildings.map((x) => (x.id === "main" ? b : x)) : [b, ...r.buildings] };
};
/** The route's walk changed, its photos' tags and (lap closed) the shape with it. */
const walked = (r: PhotoRouteState, f: (w: RouteWalk) => RouteWalk): PhotoRouteState => withWalk(r, f(r.walk ?? newWalk()));

export function PhotoWalk({
  route,
  urls,
  readOnly,
  isHouse,
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
  isHouse: boolean;
  /** "the house", or "the shed". */
  the: string;
  change: RouteChange;
  /** A photo file kept as one of the claim's Exterior photos: its place on the route, not yet added. Null if it could not be kept. */
  keep: (file: File) => Promise<RoutePhoto | null>;
  /** The claim saved now (a step taken is kept at once). */
  checkpoint: () => void;
  /** "Add photos my own way": the route as it was before the walk. */
  onOwnWay: () => void;
  /** Send to Scrivn team (TeamMeasure.tsx), for the end of the walk. */
  send: ReactNode;
  /** "Measure it here": on to tapping the corners on each photo. */
  onMeasureHere: () => void;
}) {
  const walk = route.walk ?? newWalk();
  const step = walkStep(walk);
  const main = mainOf(route);
  const attached = isAttachedHome(main.homeType);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  /** "Back where you started?" answered yes on a lap that doesn't close: what the corners make of it, to finish anyway or walk on. */
  const [problem, setProblem] = useState<string | null>(null);
  /** At a side facing the street: "No, it's more of the front" said, so the side is taken like any other. */
  const [moreFront, setMoreFront] = useState(false);
  /** The photo a measurement is being put on at the end, when none was put in on the way round. */
  const [measureOn, setMeasureOn] = useState<string | null>(null);

  const act = (f: (r: PhotoRouteState) => PhotoRouteState) => {
    setLine(null);
    setProblem(null);
    setMoreFront(false);
    change(f);
    checkpoint();
  };

  async function take(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    setBusy(true);
    const p = await keep(file);
    setBusy(false);
    if (p) act((r) => walked({ ...r, photos: [...r.photos, p] }, (w) => walkTake(w, p.id)));
  }

  /** The photo just taken taken again: the new one in its place, the old one's taps and tapes gone with it. */
  async function retake(oldId: string, files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    setBusy(true);
    const p = await keep(file);
    setBusy(false);
    if (!p) return;
    act((r) => {
      const at = r.photos.findIndex((q) => q.id === oldId);
      const base = withoutPhotos(r, [oldId]);
      const photos = [...base.photos];
      photos.splice(at < 0 ? photos.length : at, 0, p);
      const w = r.walk ?? newWalk();
      return withWalk({ ...base, photos }, { ...w, stops: w.stops.map((s) => (s.photos.includes(oldId) ? { ...s, photos: s.photos.map((x) => (x === oldId ? p.id : x)) } : s)) });
    });
  }

  const back = () =>
    act((r) => {
      const { walk: w, dropped } = walkBack(r.walk ?? newWalk());
      return withWalk(withoutPhotos(r, dropped), w);
    });

  const addTape = (photo: string, what: TapeWhat, feet: number, done: boolean) =>
    act((r) => {
      const t: RouteTape = { id: `tape-${Date.now().toString(36)}`, kind: "line", photo, a: (line as NonNullable<typeof line>).a, b: (line as NonNullable<typeof line>).b, feet, what };
      const next = withMain(r, (b) => ({ ...b, tapes: [...b.tapes, t] }));
      return done ? walked(next, walkMeasured) : next;
    });

  // The photo the last step took, to see it and take it again.
  const lastPhoto = (() => {
    const all = walkPhotos(walk);
    return step.kind === "front" || step.kind === "finish" ? null : (all[all.length - 1] ?? null);
  })();

  const head = (title: string, n: string) => (
    <div className={styles.walkHead}>
      <span className="field-note">{n}</span>
      <h3>{title}</h3>
    </div>
  );

  const takeButtons = (label: string) =>
    readOnly ? null : (
      <div className={styles.walkTake}>
        <label className={`btn-primary ${styles.walkBig}`} aria-disabled={busy}>
          {busy ? "Keeping the photo…" : label}
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => void take(e.target.files).then(() => (e.target.value = ""))} />
        </label>
        <label className="link-button">
          or choose it from the gallery
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => void take(e.target.files).then(() => (e.target.value = ""))} />
        </label>
      </div>
    );

  const footer = (
    <div className={styles.walkFoot}>
      {walk.stops.length > 0 && !readOnly && (
        <button type="button" className="link-button" onClick={back}>
          Back a step
        </button>
      )}
      {lastPhoto && (
        <span className={styles.walkLast}>
          {urls.get(lastPhoto.photo) ? <img src={urls.get(lastPhoto.photo)} alt="" /> : null}
          <span className="field-note">Last: {walkPhotoWords(lastPhoto.tag, walk)}.</span>
          {!readOnly && (
            <label className="link-button">
              Take it again
              <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => void retake(lastPhoto.photo, e.target.files).then(() => (e.target.value = ""))} />
            </label>
          )}
        </span>
      )}
      {!readOnly && (
        <button type="button" className="link-button" onClick={onOwnWay}>
          Add photos my own way
        </button>
      )}
    </div>
  );

  const count = (() => {
    const c = walk.stops.filter((s) => s.kind === "corner").length;
    return `${walkPhotos(walk).length} photo${walkPhotos(walk).length === 1 ? "" : "s"} so far${c ? `, ${c} corner${c === 1 ? "" : "s"}` : ""}`;
  })();

  if (step.kind === "front") {
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        {head("The front", "Walk round, step 1")}
        <p>
          Scrivn walks you round {the}: the front, then each corner and each side in turn, a photo at each and a measurement where you have one. Use the normal 1x camera, held
          sideways.
        </p>
        {isHouse && (
          <div className="option-group" role="group" aria-label="The home">
            {(Object.keys(HOME_TYPE_LABEL) as HomeType[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`option-btn${(main.homeType ?? "detached") === k ? " selected" : ""}`}
                aria-pressed={(main.homeType ?? "detached") === k}
                disabled={readOnly}
                onClick={() => change((r) => withMain(r, (b) => ({ ...b, homeType: k, shared: defaultShared(b.outline, k) })))}
              >
                {HOME_TYPE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <LapSketch walk={walk} step={step} />
        <p className={styles.walkSay}>Stand back across from the front, straight on, so all of it is in: both front corners, the ground and the roof edge.</p>
        {takeButtons("Take the front")}
        {footer}
      </div>
    );
  }

  if (step.kind === "measure") {
    const stop = walk.stops[step.stop];
    const photoId = stop?.photos[0] ?? "";
    const photo = route.photos.find((p) => p.id === photoId);
    const where = step.role === "front" ? "the front" : `the ${facingWords(walkHeading({ stops: walk.stops.slice(0, step.stop) }))}`;
    const tapes = main.tapes.filter((t): t is Extract<RouteTape, { kind: "line" }> => t.kind === "line" && t.photo === photoId);
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        {head(`Measure something on ${where}`, step.role === "front" ? "Walk round, step 2" : `Side ${step.k}`)}
        <p className={styles.walkSay}>
          Drag a line across something you&rsquo;ve measured, or know the size of: a garage door, or a window or a door across its frame, edge to edge. Then say how long it is.
          {step.role === "side" ? " The whole wall, corner to corner, is best of all if you have a long tape." : ""}
        </p>
        {photo && (
          <PhotoTaps
            url={urls.get(photo.id) ?? null}
            width={photo.width}
            height={photo.height}
            taps={[]}
            tapes={tapes}
            line={line}
            mode={readOnly ? null : "tape"}
            selected={null}
            onTap={() => {}}
            onPickTap={() => {}}
            onLine={(a, b) => setLine({ a, b })}
          />
        )}
        {line && <TapeForm initial={step.role === "front" ? "garage" : "window"} onCancel={() => setLine(null)} onDone={(what, feet) => addTape(photoId, what, feet, true)} />}
        {!readOnly && !line && (
          <div className={styles.row}>
            <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, walkSkip))}>
              {step.role === "front" && !walkHasMeasure(route) ? "Skip for now" : tapes.length ? "Next" : "Skip: nothing to measure here"}
            </button>
          </div>
        )}
        {step.role === "front" && !walkHasMeasure(route) && <p className="field-note">One measurement at least is needed somewhere on the walk: it sets every size.</p>}
        {footer}
      </div>
    );
  }

  if (step.kind === "corner") {
    const open = walk.stops[walk.stops.length - 1];
    const fresh = open?.kind === "corner" && open.photos.length === 0 && !(open.skipped ?? []).length;
    const turn: WalkTurn = fresh ? (open.turn ?? "outside") : "outside";
    const h = walkHeading(walk);
    if (turn === "joined") {
      // Where the home meets the neighbour's: no 45 here, the open wall at an angle from this end instead (Hover's two
      // angled shots of a middle townhouse's front and two of its back). The neighbour's far corner, put in by the walk,
      // asks the same of the wall on from it.
      const far = !!open?.auto;
      const wall = facingWords(far ? h + 1 : h);
      return (
        <div className={`${styles.card} ${styles.walk}`}>
          {head(far ? `Corner ${step.k}: the other end of the shared wall` : `Corner ${step.k}: where your home meets the neighbour's`, `${count}`)}
          {!far && <TurnChoice turn={turn} attached={attached} readOnly={readOnly} onTurn={(t) => act((r) => walked(r, (w) => walkTurn(w, t)))} />}
          <LapSketch walk={walk} step={step} />
          <p className={styles.walkSay}>
            {far ? `Go round to the ${wall}. ` : "No 45° photo here: the neighbour's home is in the way. "}
            Stand out at an angle from where your home meets the neighbour&rsquo;s, so the whole {wall} is in, both its ends, the ground and the roof edge.
          </p>
          {takeButtons(`Take the ${wall} at an angle`)}
          {!readOnly && (
            <div className={styles.row}>
              <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, walkSkip))}>
                Skip it
              </button>
            </div>
          )}
          {footer}
        </div>
      );
    }
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        {head(`Corner ${step.k}`, `${count}`)}
        <p>{step.k === 1 ? "Walk to the front's right-hand corner." : `Walk on along the ${facingWords(h)} to the next corner.`}</p>
        <TurnChoice turn={turn} attached={attached} readOnly={readOnly} onTurn={(t) => act((r) => walked(r, (w) => walkTurn(w, t)))} />
        <LapSketch walk={walk} step={step} />
        <p className={styles.walkSay}>
          Step back from the corner until both whole walls fit, with the far corner of each in the photo too: three corners in all, this one near the middle, about 45° to both
          walls. The ground and the roof edge in.
        </p>
        {takeButtons(`Take corner ${step.k}`)}
        {!readOnly && (
          <div className={styles.row}>
            <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, walkSkip))}>
              Skip this corner
            </button>
          </div>
        )}
        {footer}
      </div>
    );
  }

  if (step.kind === "inside") {
    // Asked only when the wall walked up to this inside corner had no room for a photo of its own.
    const open = walk.stops[walk.stops.length - 1];
    const nothingYet = !!open && insideWalls(open).before === undefined;
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        {head(`Inside corner ${step.k}`, `${count}`)}
        {nothingYet && <TurnChoice turn="inside" attached={attached} readOnly={readOnly} onTurn={(t) => act((r) => walked(r, (w) => walkTurn(w, t)))} />}
        <LapSketch walk={walk} step={step} />
        <p className={styles.walkSay}>
          A 45° photo doesn&rsquo;t show an inside corner: the walls either side do. The wall you walked along to it had no photo, so take it now, from wherever you can, with this corner in
          the photo.
        </p>
        {takeButtons("Take the wall before it")}
        <p className="field-note">{UPRIGHT}</p>
        {!readOnly && (
          <div className={styles.row}>
            <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, walkSkip))}>
              Skip it
            </button>
          </div>
        )}
        {footer}
      </div>
    );
  }

  if (step.kind === "side") {
    const h = walkHeading(walk);
    const facing = facingWords(h);
    const corners = walk.stops.filter((s) => s.kind === "corner").length;
    const lastStop = walk.stops[walk.stops.length - 1];
    const afterInside = lastStop?.kind === "corner" && lastStop.turn === "inside" ? corners : null;
    // Facing the street again after going round: most likely the front, reached from its left end.
    const atFront = h % 4 === 0 && h !== 0 && corners >= 3;
    const finish = () => {
      if (lapCloses(walk)) act((r) => walked(r, walkClose));
      else setProblem(lapProblem(walk));
    };
    if (problem) {
      return (
        <div className={`${styles.card} ${styles.walk}`}>
          {head("Back where you started?", `${count}`)}
          <p className={styles.ask}>{problem}</p>
          <LapSketch walk={walk} step={step} />
          <div className={styles.row}>
            <button type="button" className="btn-primary" onClick={() => setProblem(null)}>
              Keep walking
            </button>
            <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, (w) => ({ ...w, closed: true })))}>
              Finish anyway
            </button>
          </div>
          <p className="field-note">Finished anyway, the shape isn&rsquo;t drawn from the walk: you draw it, or the Scrivn team does.</p>
          {footer}
        </div>
      );
    }
    if (atFront && !moreFront && !readOnly) {
      return (
        <div className={`${styles.card} ${styles.walk}`}>
          {head("Back where you started?", `${count}`)}
          <LapSketch walk={walk} step={step} outline={lapCloses(walk) ? (lapOutline(lapTurns(walk)) ?? undefined) : undefined} shared={walkSharedSides(walk)} />
          <p className={styles.walkSay}>Does the wall from here run to corner 1, the first corner you took? Then the walk round is done: the front photo has that wall.</p>
          <div className={styles.row}>
            <button type="button" className="btn-primary" onClick={finish}>
              Yes: finish the walk
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMoreFront(true)}>
              No, there&rsquo;s more to go
            </button>
          </div>
          {footer}
        </div>
      );
    }
    return (
      <div className={`${styles.card} ${styles.walk}`}>
        {head(`The ${facing}${walk.stops.some((s, i) => (s.kind === "side" || s.kind === "front") && !s.shared && facingWords(walkHeading({ stops: walk.stops.slice(0, i) })) === facing) ? ", another part of it" : ""}`, `Side ${corners} · ${count}`)}
        <LapSketch walk={walk} step={step} />
        {afterInside !== null && (
          <p className="field-note">Corner {afterInside} is an inside corner: no 45° photo there. This wall&rsquo;s photo and the one before it show it, so keep it in the photo.</p>
        )}
        <p className={styles.walkSay}>Stand back from it, straight on, so the whole wall is in: both its corners, the ground and the roof edge. If you can.</p>
        {takeButtons("Take it")}
        <p className="field-note">{UPRIGHT}</p>
        {!readOnly && (
          <div className={styles.row}>
            <button type="button" className="btn-secondary" onClick={() => act((r) => walked(r, walkSkip))}>
              Can&rsquo;t get back far enough
            </button>
            {!atFront && corners >= 3 && (
              <button type="button" className="link-button" onClick={finish}>
                Back where I started
              </button>
            )}
          </div>
        )}
        {footer}
      </div>
    );
  }

  // The end of the walk.
  const sum = walkSummary(route);
  const closes = lapCloses(walk);
  const needMeasure = !walkHasMeasure(route);
  const measurable = walkPhotos(walk).filter((p) => p.tag.role !== "corner" || p.tag.corner === "inside");
  const on = route.photos.find((p) => p.id === measureOn) ?? null;
  return (
    <div className={`${styles.card} ${styles.walk}`}>
      {head(`Round ${the}: done`, "The end of the walk")}
      <p>
        {sum.photos} photo{sum.photos === 1 ? "" : "s"}, {sum.corners} corner{sum.corners === 1 ? "" : "s"}
        {sum.inside || sum.joined ? ` (${[sum.inside ? `${sum.inside} inside` : "", sum.joined ? `${sum.joined} at the neighbour's` : ""].filter(Boolean).join(", ")})` : ""}, {sum.measures} measurement
        {sum.measures === 1 ? "" : "s"}
        {sum.sidesSkipped ? `; ${sum.sidesSkipped} side${sum.sidesSkipped === 1 ? "" : "s"} too tight for a photo` : ""}.
      </p>
      {closes ? (
        <>
          <LapSketch walk={walk} step={step} outline={main.outline} shared={main.shared ?? []} />
          <p className="field-note">The shape your walk makes. Its sizes are rough until it&rsquo;s measured: the photos and your measurements set them.</p>
        </>
      ) : (
        <p className="field-note">The corners don&rsquo;t make a closed shape, so it isn&rsquo;t drawn from the walk: draw it below, or the Scrivn team will.</p>
      )}
      {needMeasure && !readOnly ? (
        <div className={styles.ask}>
          <p>One measurement is needed: it sets every size. Pick a photo and drag across something you&rsquo;ve measured or know the size of.</p>
          <div className={styles.thumbs}>
            {measurable.map(({ photo, tag }) => (
              <button key={photo} type="button" className={`${styles.thumb} ${photo === measureOn ? styles.thumbOn : ""}`} onClick={() => (setMeasureOn(photo), setLine(null))} title={walkPhotoWords(tag, walk)}>
                {urls.get(photo) ? <img src={urls.get(photo)} alt={walkPhotoWords(tag, walk)} /> : <span className="field-note">waiting</span>}
              </button>
            ))}
          </div>
          {on && (
            <PhotoTaps url={urls.get(on.id) ?? null} width={on.width} height={on.height} taps={[]} tapes={[]} line={line} mode="tape" selected={null} onTap={() => {}} onPickTap={() => {}} onLine={(a, b) => setLine({ a, b })} />
          )}
          {on && line && <TapeForm onCancel={() => setLine(null)} onDone={(what, feet) => addTape(on.id, what, feet, false)} />}
        </div>
      ) : (
        !readOnly && (
          <>
            <p className={styles.walkSay}>Send it to the Scrivn team to measure, or measure it here: tap the corners on each photo, then Measure.</p>
            <div className={styles.row}>
              {send}
              <button type="button" className="btn-secondary" onClick={onMeasureHere}>
                Measure it here
              </button>
            </div>
          </>
        )
      )}
      {!readOnly && (
        <div className={styles.walkFoot}>
          <button type="button" className="link-button" onClick={back}>
            Back to the walk
          </button>
        </div>
      )}
    </div>
  );
}

/** Outside (the default), inside, or - an attached home - joined to the neighbour's here. One tap, before the photo. */
function TurnChoice({ turn, attached, readOnly, onTurn }: { turn: WalkTurn; attached: boolean; readOnly: boolean; onTurn: (t: WalkTurn) => void }) {
  const options: [WalkTurn, string][] = [
    ["outside", "Outside corner"],
    ["inside", "Inside corner"],
    ...(attached ? ([["joined", "Joined to the neighbour"]] as [WalkTurn, string][]) : []),
  ];
  return (
    <>
      <div className="option-group" role="group" aria-label="Which kind of corner">
        {options.map(([t, label]) => (
          <button key={t} type="button" className={`option-btn${turn === t ? " selected" : ""}`} aria-pressed={turn === t} disabled={readOnly} onClick={() => onTurn(t)}>
            {label}
          </button>
        ))}
      </div>
      <p className="field-note">
        Outside: the corner sticks out towards you. Inside: it&rsquo;s tucked in, two walls meeting in a notch.
        {attached ? " Joined: your home meets the neighbour's here, and the wall after it is shared." : ""}
      </p>
    </>
  );
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const dirOf = (h: number) => DIRS[((h % 4) + 4) % 4] as [number, number];
/** The outside of a side running along d, the house on its left: to its right. */
const outwardOf = (d: [number, number]): [number, number] => [d[1], -d[0]];

/**
 * The walk so far, drawn small: the front at the bottom, each side walked round from its right-hand corner, the corners
 * numbered, and where to stand for the next photo in orange. Sides are drawn rough (the walk knows the turns, not the
 * sizes); with the lap closed, the shape it makes.
 */
function LapSketch({ walk, step, outline, shared = [] }: { walk: RouteWalk; step: WalkStep; outline?: Pt[]; shared?: number[] }) {
  // The corners reached so far: the front's left (0) and right (1) ends, then one each corner passed.
  const pts: Pt[] = [];
  const labels: string[] = [];
  let you: Pt | null = null;
  let aim: Pt | null = null;
  let stub: [Pt, Pt] | null = null;
  if (outline && outline.length >= 4) {
    outline.forEach((p, i) => {
      pts.push(p);
      labels.push(String(i + 1));
    });
  } else {
    // The corners passed: not one said to be outside and not yet taken (the walk is still on its way to it).
    const lastStop = walk.stops[walk.stops.length - 1];
    const open = step.kind === "corner" && lastStop?.kind === "corner" ? lastStop : null;
    const corners = walk.stops.filter((s) => s.kind === "corner" && s !== open);
    const turns = corners.map((s) => (s.turn === "inside" ? -1 : 1));
    pts.push({ x: 0, y: 0 }, { x: 40, y: 0 });
    labels.push("", "1");
    let h = 0;
    // Corner k's turn sets side k's way; each side is drawn rough: long between two outside corners, short beside a notch.
    for (let k = 1; k < corners.length; k++) {
      h += turns[k - 1] as number;
      const next = turns[k];
      const short = turns[k - 1] === -1 || next === -1;
      const L = short ? 12 : h % 2 === 0 ? 40 : 30;
      const [dx, dy] = dirOf(h);
      const p = pts[pts.length - 1] as Pt;
      pts.push({ x: p.x + dx * L, y: p.y + dy * L });
      labels.push(String(k + 1));
    }
    const last = pts[pts.length - 1] as Pt;
    const hNow = walkHeading(walk);
    if (step.kind === "front") {
      you = { x: 20, y: -22 };
      aim = { x: 20, y: 0 };
    } else if (step.kind === "measure" && step.role === "front") {
      you = { x: 20, y: -22 };
      aim = { x: 20, y: 0 };
    } else if (step.kind === "corner") {
      // Walking to the next corner: the side before it drawn on as far as it goes.
      const hIn = hNow;
      const [dx, dy] = dirOf(hIn);
      const reach = corners.length === 0 ? null : { x: last.x + dx * (hIn % 2 === 0 ? 40 : 30), y: last.y + dy * (hIn % 2 === 0 ? 40 : 30) };
      const at = corners.length === 0 ? (pts[1] as Pt) : (reach as Pt);
      if (reach) stub = [last, reach];
      const n1 = outwardOf(dirOf(hIn));
      const n2 = outwardOf(dirOf(hIn + 1));
      const bx = n1[0] + n2[0];
      const by = n1[1] + n2[1];
      const bl = Math.hypot(bx, by) || 1;
      you = { x: at.x + (12 * bx) / bl, y: at.y + (12 * by) / bl };
      aim = at;
    } else if (step.kind === "inside") {
      // The wall walked up to the inside corner, straight on.
      const d = dirOf(hNow + 1);
      const from = pts[pts.length - 2] as Pt;
      const mid = { x: (from.x + last.x) / 2, y: (from.y + last.y) / 2 };
      const nrm = outwardOf(d);
      you = { x: mid.x + nrm[0] * 14, y: mid.y + nrm[1] * 14 };
      aim = mid;
    } else if (step.kind === "side" || step.kind === "measure") {
      const d = dirOf(hNow);
      const L = hNow % 2 === 0 ? 40 : 30;
      const end = { x: last.x + d[0] * L, y: last.y + d[1] * L };
      stub = [last, end];
      const mid = { x: (last.x + end.x) / 2, y: (last.y + end.y) / 2 };
      const nrm = outwardOf(d);
      you = { x: mid.x + nrm[0] * 16, y: mid.y + nrm[1] * 16 };
      aim = mid;
    }
  }
  const all = [...pts, ...(you ? [you] : []), ...(stub ? stub : [])];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const span = Math.max(x1 - x0, y1 - y0, 30);
  const pad = span * 0.12;
  const W = x1 - x0 + 2 * pad;
  const H = y1 - y0 + 2 * pad;
  const P = (p: Pt) => ({ x: p.x - x0 + pad, y: y1 - p.y + pad });
  const r = span * 0.035;
  const closed = !!outline && outline.length >= 4;
  const path = pts.map((p) => `${P(p).x},${P(p).y}`).join(" ");
  return (
    <svg className={styles.walkPlan} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={closed ? "The shape the walk makes" : "The walk so far, and where to stand next"}>
      {closed ? (
        <polygon points={path} fill="rgba(8,145,178,0.08)" stroke="#0891b2" strokeWidth={span * 0.01} />
      ) : (
        <>
          <polyline points={path} fill="none" stroke="#0891b2" strokeWidth={span * 0.012} strokeLinejoin="round" />
          <line x1={P(pts[0] as Pt).x} y1={P(pts[0] as Pt).y} x2={P(pts[1] as Pt).x} y2={P(pts[1] as Pt).y} stroke="#0e7490" strokeWidth={span * 0.022} />
          <text x={(P(pts[0] as Pt).x + P(pts[1] as Pt).x) / 2} y={P(pts[0] as Pt).y + r * 2.2} fontSize={r * 1.3} textAnchor="middle" fill="#0e7490">
            front
          </text>
        </>
      )}
      {closed &&
        shared.map((i) => {
          const a = P(pts[i] as Pt);
          const b = P(pts[(i + 1) % pts.length] as Pt);
          return (
            <g key={`shared${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a8a29e" strokeWidth={span * 0.02} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={r * 1.2} textAnchor="middle" fill="#78716c" stroke="#fff" strokeWidth={r * 0.2} paintOrder="stroke">
                shared
              </text>
            </g>
          );
        })}
      {stub && <line x1={P(stub[0]).x} y1={P(stub[0]).y} x2={P(stub[1]).x} y2={P(stub[1]).y} stroke="#ea580c" strokeWidth={span * 0.012} strokeDasharray={`${r} ${r * 0.6}`} />}
      {pts.map((p, i) =>
        labels[i] ? (
          <g key={i}>
            <circle cx={P(p).x} cy={P(p).y} r={r} fill="#0891b2" />
            <text x={P(p).x} y={P(p).y + r * 0.42} fontSize={r * 1.15} textAnchor="middle" fill="#fff">
              {labels[i]}
            </text>
          </g>
        ) : null,
      )}
      {you && aim && (
        <g pointerEvents="none">
          <line x1={P(you).x} y1={P(you).y} x2={P(aim).x} y2={P(aim).y} stroke="#ea580c" strokeWidth={span * 0.006} strokeDasharray={`${r * 0.5} ${r * 0.4}`} />
          <circle cx={P(you).x} cy={P(you).y} r={r * 1.25} fill="#ea580c" />
          <text x={P(you).x} y={P(you).y + r * 0.45} fontSize={r * 1.1} textAnchor="middle" fill="#fff">
            you
          </text>
        </g>
      )}
    </svg>
  );
}
