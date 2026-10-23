/**
 * The walk round the house (2026-10-21): the photo route's way in, one prompted step at a time. Blind tests on a test
 * house that week showed the front reliable, the photos showing ONE corner of the house impossible to place (the back and
 * sides drifting far), and a photo at 45 degrees to every outside corner with a measurement on each side as the
 * capture that holds. So the walk asks for exactly that, in order:
 *
 *   the front, straight on, and anything on it measured, typed (a garage door; a window or a door across its frame);
 *   then round the house in one direction, the front's right-hand corner first: each corner at 45 degrees - or, at an
 *   inside corner, where no 45 shows it, the walls either side of it, which are the sides' own photos (the wall before it
 *   asked for there only when its side had no room for one) - and each side straight on if there's room to get back,
 *   with a measurement on it if there is one; until back at the front. Then Send to Scrivn team, or Measure.
 *
 * Where the home meets the neighbour's (a semi, a townhouse) there is no corner to stand at 45 degrees to: the walk asks
 * instead for the open wall at an angle from that end, the whole wall and both its ends in - so a middle townhouse gets
 * two angled photos of its front and two of its back, as Hover asks for (2026-10-21). Nothing is asked up front: no shape,
 * no kind of home (the owner, 10-21: "rather just next corner, next elevation until you say finished"). A corner said to
 * meet the neighbour's is where a shared wall is, and the home's type follows from how many there are (`walkHomeType`).
 *
 * A measurement is typed, never drawn (2026-10-21: a line dragged across a garage door on a photo the size of a phone was
 * "borderline impossible" on the owner's phone, and the first walk was pulled for it). At the front and at each side,
 * "Did you measure anything here?": what it was, its size in feet, inches and an eighth, and - if they like - one tap on
 * the photo roughly on it (`WalkMeasure`). Its ends are placed afterwards: by the Scrivn team for a walk sent to them (the
 * house runner's `tape tN P = ...`), or in the route on a bigger screen. A wall's length needs no ends: once the lap
 * closes it is that side's tape (`withWalk`). One measurement at least before the walk can finish.
 *
 * The lap says the house's shape: how many corners, and at each whether the walk went round the outside of the house or
 * into a notch. That is the outline (`lapOutline`), its sizes rough until measured, so nobody draws it by hand; and each
 * photo's place on it (`RoutePhoto.shot`), so the corners tapped on a photo are named by what it was taken for.
 *
 * Walking with the house on the left (the front's right-hand corner first): an outside corner turns the walk a quarter
 * left, an inside corner a quarter right, and a closed lap four quarters left. Plan feet as lib/photoRoute.ts: x east, y
 * north, the street at the bottom, the outline counter-clockwise from above. The walk's corner k is the outline's corner
 * k - 1, which the plan shows as k (it numbers its corners from 1): corner 1 is the front's right-hand end, the last the
 * front's left. The walk's side k runs from corner k to the next, the outline's side k - 1; the front, the walk's side 0,
 * is the outline's last, from the last corner round to corner 1.
 */

import { type HomeType, isAttachedHome } from "./exterior";
import type { CornerTap, PhotoRouteState, RouteBuilding, RoutePhoto, RouteShot, RouteTape, TapeWhat } from "./photoRoute";
import type { Pt } from "./roof";
import { formatFeetInches } from "./sketch";

/** A corner as walked: round the outside of the house, into a notch, or (an attached home) where it meets the neighbour's. */
export type WalkTurn = "outside" | "inside" | "joined";

/** What can be passed by at a stop: its photo; at an inside corner, the wall before it. */
export type WalkPart = "photo" | "before" | "after";

/**
 * A measurement typed on the walk (2026-10-21): what was measured and its size, on the stop's photo, with at most one rough
 * tap on it. Not a tape until its ends are placed (a `RouteTape` "line" with this id), except a wall's length on the front
 * or a side, which is that side's tape once the lap closes (`withWalk`: a "side" tape with this id).
 */
export interface WalkMeasure {
  /** "walk-...": the tape made of it keeps it. */
  id: string;
  what: TapeWhat;
  feet: number;
  /** The photo it is on: the stop's. None for a wall too tight to photograph ("Can't get back far enough"). */
  photo?: string;
  /** One tap on the photo, roughly on what was measured (its pixels): where to look, never its ends. */
  near?: [number, number];
  /**
   * A close-up of the tape on it (2026-10-22): a claim photo, kept with the claim's Exterior photos and sent to the Scrivn
   * team, never one of the route's (it shows the tape, not the house). The owner's tape close-ups were the most useful
   * thing he sent: the number and the tape's exact ends read off them.
   */
  tapePhoto?: string;
}

/** One stop of the walk, as done. */
export interface WalkStop {
  kind: "front" | "corner" | "side";
  /** A corner's: outside unless said. */
  turn?: WalkTurn;
  /** The photos taken here, by claim photo id: one; at an inside corner, the wall before it when its side had no photo. */
  photos: string[];
  /** Asked for and not taken: a side's photo ("Can't get back far enough"), a corner's 45, an inside corner's wall before it. */
  skipped?: WalkPart[];
  /** A side shared with the neighbour's home: not photographed, not measured. */
  shared?: true;
  /** A front's or a side's "Did you measure anything here?": answered with a measurement or more, or passed by. */
  measure?: "done" | "skipped";
  /** What was measured here, typed (`WalkMeasure`). */
  measures?: WalkMeasure[];
  /**
   * Put in by the walk with the stop before it - a joined corner's shared wall and the neighbour's far corner, once the
   * joined corner's own photo is taken or passed by - and taken out with it.
   */
  auto?: true;
}

/** The walk as kept on the route (`PhotoRouteState.walk`): what was done, so a walk half done picks up where it was. */
export interface RouteWalk {
  stops: WalkStop[];
  /** Back at the front: the lap is done. */
  closed?: true;
  /** "Add photos my own way": the walk set aside for the route as it was before, its photos kept. */
  own?: true;
}

/** A photo's place on the walk (`RoutePhoto.walk`): the front, side k or corner k, and an inside corner's which wall. */
export interface WalkTag {
  role: "front" | "side" | "corner";
  /** Its number on the walk: corner k is the k-th passed, the front's right-hand one first; side k follows corner k; the front is 0. */
  k: number;
  corner?: "outside" | "inside" | "joined";
  /**
   * At an inside corner: the photo of the wall walked up to it (asked only when that side had none of its own). At a joined
   * one: the open wall shot at an angle from this end - the one walked up to it ("before"), or the one on from the
   * neighbour's far corner ("after").
   */
  wall?: "before" | "after";
  /**
   * More of the same wall or corner (2026-10-22, the flexible walk): a photo after the first of it - part of a long wall,
   * above or below a deck. It names no corners by its role: they are numbered as any photo's are.
   */
  part?: true;
}

/** Where the walk is: what the card asks for next. */
export type WalkStep =
  | { kind: "front" }
  /** "Did you measure anything here?" at the front or a side: on its photo, or (a side too tight for one) its length only. */
  | { kind: "measure"; stop: number; role: "front" | "side"; k: number; photo: string | null }
  | { kind: "corner"; k: number }
  | { kind: "inside"; k: number; wall: "before" | "after" }
  | { kind: "side"; k: number }
  | { kind: "finish" };

export function newWalk(): RouteWalk {
  return { stops: [] };
}

/** The walk is the way in while it's on: started, not set aside. A route with no walk at all is the route as it was. */
export function walkActive(route: Pick<PhotoRouteState, "walk">): boolean {
  return !!route.walk && !route.walk.own;
}

const turnOf = (s: WalkStop): WalkTurn => s.turn ?? "outside";

/** A quarter turn: +1 round an outside corner (or a joined one, the neighbour's), -1 into an inside one. */
const quarter = (t: WalkTurn) => (t === "inside" ? -1 : 1);

/**
 * An inside corner's own photo, of the wall walked up to it: a photo id, null passed by, undefined not asked yet. Asked only
 * when that wall's side had no photo ("Can't get back far enough"): a side's photo straight on, both its corners in, shows
 * the inside corner at its end, and the next side's photo shows it at its start.
 */
export function insideWalls(s: WalkStop): { before: string | null | undefined } {
  if (s.skipped?.includes("before")) return { before: null };
  return { before: s.photos[0] };
}

/** Whether an inside corner still wants the wall before it: when the stop before it - that wall - has no photo. */
function wantsWallBefore(prev: WalkStop | undefined): boolean {
  return !(prev && (prev.kind === "front" || prev.kind === "side") && prev.photos.length > 0);
}

/** Whether a corner stop is done with: its 45 (a joined one's angled photo) taken or passed by, an inside one's wall before it had or asked. */
function cornerDone(s: WalkStop, prev: WalkStop | undefined): boolean {
  const t = turnOf(s);
  if (t === "inside") return !wantsWallBefore(prev) || insideWalls(s).before !== undefined;
  return s.photos.length > 0 || !!s.skipped?.includes("photo");
}

/** Each stop's number on the walk: the front 0, corner k the k-th corner, side k the one after corner k. */
export function stopNumbers(walk: RouteWalk): number[] {
  let k = 0;
  return walk.stops.map((s) => {
    if (s.kind === "corner") k += 1;
    return s.kind === "front" ? 0 : k;
  });
}

export function walkStep(walk: RouteWalk): WalkStep {
  if (walk.closed) return { kind: "finish" };
  const stops = walk.stops;
  const last = stops[stops.length - 1];
  if (!last) return { kind: "front" };
  const i = stops.length - 1;
  const k = stopNumbers(walk)[i] as number;
  if (last.kind === "front" || last.kind === "side") {
    if (!last.shared && !last.measure) return { kind: "measure", stop: i, role: last.kind, k, photo: last.photos[0] ?? null };
    return { kind: "corner", k: k + 1 };
  }
  const prev = stops[i - 1];
  if (turnOf(last) === "inside" && !cornerDone(last, prev)) return { kind: "inside", k, wall: "before" };
  return cornerDone(last, prev) ? { kind: "side", k } : { kind: "corner", k };
}

/** The corner stop being asked about, if the walk has one open (a turn said, its photo not yet taken). */
function openCorner(walk: RouteWalk): number | null {
  const step = walkStep(walk);
  const i = walk.stops.length - 1;
  const last = walk.stops[i];
  if ((step.kind === "corner" || step.kind === "inside") && last?.kind === "corner" && !cornerDone(last, walk.stops[i - 1])) return i;
  return null;
}

const withStops = (walk: RouteWalk, stops: WalkStop[]): RouteWalk => ({ ...walk, stops });

/** A photo taken at the step the walk is on. */
export function walkTake(walk: RouteWalk, photo: string): RouteWalk {
  const step = walkStep(walk);
  const stops = [...walk.stops];
  if (step.kind === "front") return withStops(walk, [...stops, { kind: "front", photos: [photo] }]);
  if (step.kind === "side") return withStops(walk, [...stops, { kind: "side", photos: [photo] }]);
  if (step.kind === "corner" || step.kind === "inside") {
    const open = openCorner(walk);
    if (open === null) return withStops(walk, [...stops, { kind: "corner", photos: [photo] }]);
    const s = stops[open] as WalkStop;
    stops[open] = { ...s, photos: [...s.photos, photo] };
    return withStops(walk, withShared(stops));
  }
  return walk;
}

/** A joined corner just done with (not one the walk put in): the shared wall after it, and the neighbour's far corner. */
function withShared(stops: WalkStop[]): WalkStop[] {
  const last = stops[stops.length - 1];
  if (!last || last.kind !== "corner" || last.turn !== "joined" || last.auto) return stops;
  return [...stops, { kind: "side", photos: [], shared: true, auto: true }, { kind: "corner", turn: "joined", photos: [], auto: true }];
}

/** The step passed by: a side's photo, a corner's 45, an inside corner's wall before it, a measurement. The front's photo can't be. */
export function walkSkip(walk: RouteWalk): RouteWalk {
  const step = walkStep(walk);
  const stops = [...walk.stops];
  if (step.kind === "side") return withStops(walk, [...stops, { kind: "side", photos: [], skipped: ["photo"] }]);
  if (step.kind === "measure") {
    stops[step.stop] = { ...(stops[step.stop] as WalkStop), measure: "skipped" };
    return withStops(walk, stops);
  }
  if (step.kind === "corner" || step.kind === "inside") {
    const part: WalkPart = step.kind === "inside" ? "before" : "photo";
    const open = openCorner(walk);
    if (open === null) return withStops(walk, [...stops, { kind: "corner", photos: [], skipped: [part] }]);
    const s = stops[open] as WalkStop;
    stops[open] = { ...s, skipped: [...(s.skipped ?? []), part] };
    return withStops(walk, withShared(stops));
  }
  return walk;
}

/** "Did you measure anything here?" answered: "done" with a measurement or more put in, else passed by. */
export function walkMeasured(walk: RouteWalk): RouteWalk {
  const step = walkStep(walk);
  if (step.kind !== "measure") return walk;
  const stops = [...walk.stops];
  const s = stops[step.stop] as WalkStop;
  stops[step.stop] = { ...s, measure: (s.measures ?? []).length ? "done" : "skipped" };
  return withStops(walk, stops);
}

/** A measurement typed at stop `stop`: the measure step's, or - one asked for before finishing - any stop's photo. */
export function walkAddMeasure(walk: RouteWalk, stop: number, m: WalkMeasure): RouteWalk {
  const s = walk.stops[stop];
  if (!s || !(m.feet > 0)) return walk;
  const stops = [...walk.stops];
  stops[stop] = { ...s, measures: [...(s.measures ?? []), m] };
  return withStops(walk, stops);
}

/** A measurement taken out, wherever it is. */
export function walkRemoveMeasure(walk: RouteWalk, id: string): RouteWalk {
  return withStops(
    walk,
    walk.stops.map((s) => (s.measures?.some((m) => m.id === id) ? { ...s, measures: s.measures.filter((m) => m.id !== id) } : s)),
  );
}

/** Every measurement of the walk, with its stop and that stop's number and kind, in the order walked. */
export function walkMeasures(walk: RouteWalk): { m: WalkMeasure; stop: number; kind: WalkStop["kind"]; k: number }[] {
  const nums = stopNumbers(walk);
  return walk.stops.flatMap((s, i) => (s.measures ?? []).map((m) => ({ m, stop: i, kind: s.kind, k: nums[i] as number })));
}

/** A new measurement's id: "walk-", so the side tape a wall's length makes is known as the walk's (`withWalk`). */
export function newMeasureId(): string {
  return `walk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The home's type from the walk: a corner said to meet the neighbour's is where a shared wall is - one, a semi (or an end
 * townhouse, if already said so); two or more, a middle townhouse. None: as it was, unless that was an attached home.
 */
export function walkHomeType(walk: RouteWalk, was: HomeType | undefined): HomeType | undefined {
  const joined = walk.stops.filter((s) => s.kind === "corner" && s.turn === "joined" && !s.auto).length;
  if (joined >= 2) return "town_middle";
  if (joined === 1) return was === "town_end" ? "town_end" : "semi";
  return isAttachedHome(was) ? "detached" : was;
}

/**
 * The corner being asked about is outside (the default), inside, or where this home meets the neighbour's. Said before
 * its photo. A joined corner asks for the wall walked up to it, at an angle from this end; then it puts in the shared wall
 * after it, never photographed, and the neighbour's far corner, which asks for the open wall on from there the same way.
 */
export function walkTurn(walk: RouteWalk, turn: WalkTurn): RouteWalk {
  const step = walkStep(walk);
  if (step.kind !== "corner" && step.kind !== "inside") return walk;
  const open = openCorner(walk);
  const stops = [...walk.stops];
  const prev = open === null ? null : (stops[open] as WalkStop);
  // A turn changed once a photo is in would leave the photo of the wrong thing: Back first.
  if (prev && (prev.photos.length > 0 || (prev.skipped ?? []).length > 0)) return walk;
  const at: WalkStop = { kind: "corner", photos: [], ...(turn === "outside" ? {} : { turn }) };
  if (open === null) stops.push(at);
  else stops[open] = at;
  return withStops(walk, stops);
}

/** Back at the front: the lap is done. Asked at a side step - the side about to be taken is the front, taken first. */
export function walkClose(walk: RouteWalk): RouteWalk {
  return walkStep(walk).kind === "side" ? { ...walk, closed: true } : walk;
}

/**
 * One step back: the lap opened again, a measurement asked again, a photo or a pass taken back, a turn unsaid. The photos
 * of what is taken back are listed (`dropped`): they leave the route, and stay on the claim as its Exterior photos.
 */
export function walkBack(walk: RouteWalk): { walk: RouteWalk; dropped: string[] } {
  if (walk.closed) {
    const { closed: _c, ...rest } = walk;
    return { walk: rest, dropped: [] };
  }
  const stops = [...walk.stops];
  const last = stops[stops.length - 1];
  if (!last) return { walk, dropped: [] };
  if ((last.kind === "front" || last.kind === "side") && last.measure) {
    const { measure: _m, ...rest } = last;
    stops[stops.length - 1] = rest;
    return { walk: withStops(walk, stops), dropped: [] };
  }
  // The neighbour's far corner: its angled photo first; then, with the shared wall, back to the joined corner's own photo.
  if (last.auto) {
    if (last.photos.length > 0 || (last.skipped ?? []).length > 0) {
      stops[stops.length - 1] = { ...last, photos: [], skipped: [] };
      return { walk: withStops(walk, stops), dropped: last.photos };
    }
    while (stops.length && stops[stops.length - 1]?.auto) stops.pop();
    const joined = stops[stops.length - 1] as WalkStop;
    stops[stops.length - 1] = { ...joined, photos: [], skipped: [] };
    return { walk: withStops(walk, stops), dropped: joined.photos };
  }
  if (last.kind === "corner" && turnOf(last) === "inside") {
    // Its wall before it first (taken or passed by), then the turn itself.
    const w = insideWalls(last);
    if (w.before !== undefined) {
      stops[stops.length - 1] = { ...last, photos: [], skipped: (last.skipped ?? []).filter((p) => p !== "before") };
      return { walk: withStops(walk, stops), dropped: w.before === null ? [] : [w.before] };
    }
  }
  stops.pop();
  return { walk: withStops(walk, stops), dropped: last.photos };
}

/**
 * The walk's quarter turns so far: the way the next side faces, 0 the street's way (the front), 1 right, 2 back, 3 left. A
 * corner said to be outside or joined but not yet taken isn't passed yet; an inside one being taken is (its walls are
 * either side).
 */
export function walkHeading(walk: Pick<RouteWalk, "stops">): number {
  const stops = walk.stops;
  return stops.reduce((h, s, i) => {
    if (s.kind !== "corner") return h;
    if (i === stops.length - 1 && turnOf(s) !== "inside" && !cornerDone(s, stops[i - 1])) return h;
    return h + quarter(turnOf(s));
  }, 0);
}

/** The turns of the corners passed, in order: +1 outside or joined, -1 inside. */
export function lapTurns(walk: RouteWalk): number[] {
  return walk.stops.filter((s) => s.kind === "corner").map((s) => quarter(turnOf(s)));
}

/** Which way a side faces, in words, from the walk's quarter turns before it. */
export function facingWords(h: number): "front" | "right side" | "back" | "left side" {
  return (["front", "right side", "back", "left side"] as const)[((h % 4) + 4) % 4] as "front" | "right side" | "back" | "left side";
}

/** Whether the lap as walked closes: four corners or more, four quarters left in all. */
export function lapCloses(walk: RouteWalk): boolean {
  const t = lapTurns(walk);
  return t.length >= 4 && t.reduce((s, x) => s + x, 0) === 4;
}

/**
 * Said when "Back at the front" doesn't close the lap: what the corners make of it. A closed lap goes four quarters
 * left: three means a corner missed (or an inside one said as outside), five an outside one said as inside, and so on.
 */
export function lapProblem(walk: RouteWalk): string | null {
  const t = lapTurns(walk);
  if (lapCloses(walk)) return null;
  const out = t.filter((x) => x > 0).length;
  const inn = t.length - out;
  const counted = `${out} outside corner${out === 1 ? "" : "s"}${inn ? ` and ${inn} inside` : ""}`;
  if (t.length < 4) return `That's ${t.length} corner${t.length === 1 ? "" : "s"} so far: a house has four at least. Carry on round to the front.`;
  const net = out - inn;
  return net < 4
    ? `That's ${counted}: a lap round a house has four more outside corners than inside ones. A corner may be missed, or one said inside that sticks out.`
    : `That's ${counted}: a lap round a house has four more outside corners than inside ones. A corner said outside may be tucked in.`;
}

// ── The ring: the walk in any order (2026-10-22) ────────────────────────────────────────────────────

/*
  The walk as a ring of walls and corners the tester fills in any order. The owner, after walking his house with the
  step-by-step walk: "the guided elevation/next corner wont be super applicable as the elevations around the back deck are
  tough and i might need to get pictures above and/or below the deck ... when i was taking a picture of the AC side i had to
  go around that fence to get it, then back around to get the measurement, then back around to get the corner photo".

  The ring is the same stops as the walk's: the front; then each corner as said (outside, inside, joining the neighbour's)
  and the wall after it, round the house with it on the left. Saying the next corner adds it and the wall after it; photos
  go on any wall or corner, as many as wanted, whenever; measurements on any wall, any time (`walkAddMeasure`). The shape
  comes from the corners, as the lap's always did (`lapOutline`). Nothing waits on anything: Finish is there all along, with
  what is still missing said plainly (`walkMissing`).
*/

/** The ring with its front: a walk not started yet has none. */
export function withRingStart(walk: RouteWalk): RouteWalk {
  return walk.stops.length > 0 ? walk : withStops(walk, [{ kind: "front", photos: [] }]);
}

/**
 * The next corner round, and the wall after it. Joining the neighbour's, the shared wall and the neighbour's far corner go
 * in with it (as `walkTurn` puts them in), then the open wall on from there.
 */
export function walkAddCorner(walk: RouteWalk, turn: WalkTurn): RouteWalk {
  if (walk.closed) return walk;
  const stops = [...withRingStart(walk).stops];
  if (stops[stops.length - 1]?.kind === "corner") stops.push({ kind: "side", photos: [] });
  return walkInsertCorner(withStops(walk, stops), stops.length - 1, turn);
}

/** A corner as said, with the shared wall and the neighbour's far corner a joined one brings (`walkTurn`'s). */
function cornerStops(turn: WalkTurn): WalkStop[] {
  return [
    { kind: "corner", photos: [], ...(turn === "outside" ? {} : { turn }) },
    ...(turn === "joined" ? ([{ kind: "side", photos: [], shared: true, auto: true }, { kind: "corner", turn: "joined", photos: [], auto: true }] as WalkStop[]) : []),
  ];
}

/**
 * A corner partway along a wall (2026-10-22): the wall `wallStop` ends at it, and a new wall goes on from it - a notch or a
 * step found after the walls round it were said. The wall keeps its photos and measurements. The owner, 10-22, stuck at
 * the fourth corner of a twelve-cornered house: "I've been wanting to add the elevations and each corner I could".
 */
export function walkInsertCorner(walk: RouteWalk, wallStop: number, turn: WalkTurn): RouteWalk {
  const ring = withRingStart(walk);
  const at = ring.stops[wallStop];
  if (walk.closed || !at || at.kind === "corner" || at.shared) return walk;
  const stops = [...ring.stops];
  stops.splice(wallStop + 1, 0, ...cornerStops(turn), { kind: "side", photos: [] });
  return withStops(ring, stops);
}

/** The joined corner a stop belongs to: itself, or for the neighbour's far corner the joined one the walk put it in with. */
function cornerOwner(stops: WalkStop[], i: number): number {
  let j = i;
  while (j > 0 && stops[j]?.auto) j -= 1;
  return j;
}

/** How many stops a corner takes: one, or with a joined one's shared wall and far corner, three. */
function cornerSpan(stops: WalkStop[], j: number): number {
  let n = 1;
  while (stops[j + n]?.auto) n += 1;
  return n;
}

/**
 * A corner said as another kind (2026-10-22): outside, inside or joining the neighbour's - fixed where it stands, the walls
 * either side and their photos kept. Joining brings its shared wall and far corner; leaving it takes them out (their photos listed).
 */
export function walkSetTurn(walk: RouteWalk, cornerStop: number, turn: WalkTurn): { walk: RouteWalk; dropped: string[] } {
  const stops = [...walk.stops];
  const j = cornerOwner(stops, cornerStop);
  const c = stops[j];
  if (walk.closed || !c || c.kind !== "corner") return { walk, dropped: [] };
  const span = cornerSpan(stops, j);
  const dropped = stops.slice(j + 1, j + span).flatMap((s) => s.photos);
  const [first, ...chain] = cornerStops(turn);
  const kept: WalkStop = { ...(first as WalkStop), photos: c.photos, ...(c.skipped ? { skipped: c.skipped } : {}) };
  stops.splice(j, span, kept, ...chain);
  return { walk: withStops(walk, stops), dropped };
}

/**
 * A corner taken out (2026-10-22), wherever it is: the wall after it joins the wall before it, its photos and measurements
 * with it; the corner's own photos (and a joined one's far corner's) are listed, to leave the walk.
 */
export function walkRemoveCorner(walk: RouteWalk, cornerStop: number): { walk: RouteWalk; dropped: string[] } {
  const stops = [...walk.stops];
  const j = cornerOwner(stops, cornerStop);
  if (walk.closed || stops[j]?.kind !== "corner") return { walk, dropped: [] };
  const span = cornerSpan(stops, j);
  const dropped = stops.slice(j, j + span).flatMap((s) => s.photos);
  const before = stops[j - 1] as WalkStop;
  const after = stops[j + span];
  const merged: WalkStop = after
    ? { ...before, photos: [...before.photos, ...after.photos], ...(before.measures?.length || after.measures?.length ? { measures: [...(before.measures ?? []), ...(after.measures ?? [])] } : {}) }
    : before;
  stops.splice(j - 1, span + (after ? 2 : 1), merged);
  return { walk: withStops(walk, stops), dropped };
}

/** The last corner said taken back, with the wall after it (a joined one's shared wall and far corner too): their photos listed. */
export function walkRemoveLastCorner(walk: RouteWalk): { walk: RouteWalk; dropped: string[] } {
  if (walk.closed) return { walk, dropped: [] };
  const stops = [...walk.stops];
  const dropped: string[] = [];
  const pop = () => dropped.push(...((stops.pop() as WalkStop).photos ?? []));
  if (stops[stops.length - 1]?.kind === "side" && stops.length > 1) pop();
  if (stops[stops.length - 1]?.kind !== "corner") return { walk, dropped: [] };
  while (stops[stops.length - 1]?.auto) pop();
  pop();
  return { walk: withStops(walk, stops), dropped };
}

/** A photo put on a wall or corner of the ring (`stop`), after any it has. */
export function walkAddPhoto(walk: RouteWalk, stop: number, photo: string): RouteWalk {
  const s = walk.stops[stop];
  if (!s || s.shared) return walk;
  return withStops(walk, walk.stops.map((x, i) => (i === stop ? { ...x, photos: [...x.photos, photo] } : x)));
}

/** A photo taken off the ring, wherever it is: a measurement it was on keeps its size and loses its place on it. */
export function walkRemovePhoto(walk: RouteWalk, photo: string): RouteWalk {
  return withStops(
    walk,
    walk.stops.map((s) => {
      const measures = s.measures?.map((m) => {
        if (m.photo !== photo) return m;
        const { photo: _p, near: _n, ...rest } = m;
        return rest;
      });
      return { ...s, photos: s.photos.filter((p) => p !== photo), ...(measures ? { measures } : {}) };
    }),
  );
}

/**
 * Finished: the ring closed round to the front when its corners close (the wall being walked to is the front's left part,
 * so whatever is on it goes on the front), or as it stands when they don't - then no shape is drawn from it.
 */
export function walkFinish(walk: RouteWalk): RouteWalk {
  const stops = [...walk.stops];
  const last = stops[stops.length - 1];
  if (lapCloses(walk) && last?.kind === "side" && !last.shared && stops.length > 1) {
    stops.pop();
    const front = stops[0] as WalkStop;
    stops[0] = { ...front, photos: [...front.photos, ...last.photos], ...(last.measures?.length ? { measures: [...(front.measures ?? []), ...last.measures] } : {}) };
  }
  return { ...withStops(walk, stops), closed: true };
}

/** Back to the ring from the end: open again, the wall after the last corner there to walk to. */
export function walkReopen(walk: RouteWalk): RouteWalk {
  const { closed: _c, ...rest } = walk;
  const stops = [...rest.stops];
  if (stops[stops.length - 1]?.kind === "corner") stops.push({ kind: "side", photos: [] });
  return { ...rest, stops };
}

/** One wall or corner of the ring, for the screen. */
export interface RingItem {
  stop: number;
  kind: "wall" | "corner";
  /** Its number: corner k, or the wall after corner k (the front 0). */
  k: number;
  label: string;
  turn?: WalkTurn;
  /** The neighbour's side of a shared wall: nothing to take. */
  shared?: true;
  /** A corner the walk put in (the neighbour's far one). */
  auto?: true;
  /** The wall after the last corner once they close round: the front again, what goes on it goes on the front. */
  again?: true;
  photos: number;
  measures: number;
}

/**
 * The ring's walls and corners in order, named: "The front", "Corner 1", "The right side", "Corner 4 (inside)". The wall
 * after the last corner, once the corners close, is the front's own left part: not listed apart.
 */
export function ringItems(walk: RouteWalk): RingItem[] {
  const ring = withRingStart(walk);
  const nums = stopNumbers(ring);
  const closes = lapCloses(ring);
  // Each wall's facing, every corner said passed, photo or not.
  const facingAt = ring.stops.map((s, i) => (s.kind === "corner" ? null : s.kind === "front" ? "front" : facingWords(ring.stops.slice(0, i).reduce((h, x) => (x.kind === "corner" ? h + quarter(turnOf(x)) : h), 0))));
  const walls = ring.stops.flatMap((s, i) => (s.kind === "corner" ? [] : [i]));
  const seen = new Map<string, number>();
  const items: RingItem[] = [];
  ring.stops.forEach((s, i) => {
    const k = nums[i] as number;
    const base = { stop: i, k, photos: s.photos.length, measures: (s.measures ?? []).length };
    if (s.kind === "corner") {
      const t = turnOf(s);
      const how = s.auto ? " (the neighbour's far end)" : t === "inside" ? " (inside)" : t === "joined" ? " (joins the neighbour)" : "";
      items.push({ ...base, kind: "corner", label: `Corner ${k}${how}`, turn: t, ...(s.auto ? { auto: true as const } : {}) });
      return;
    }
    const facing = facingAt[i] as string;
    const w = walls.indexOf(i);
    const prev = w > 0 ? facingAt[walls[w - 1] as number] : null;
    const next = w < walls.length - 1 ? facingAt[walls[w + 1] as number] : null;
    let label: string;
    // Plain names as the ring grows (2026-10-22): the four sides by the way they face, a short wall between two parts of
    // one side a jog in it, and a side met again its next part. The wall after the last corner, once they close, is the
    // front again, back to corner 1: what goes on it goes on the front.
    if (i === ring.stops.length - 1 && i > 0 && closes && !s.shared) label = "The front again, back to corner 1";
    else if (s.shared) label = `The ${facing}: shared with the neighbour`;
    // A jog: a wall facing a side between two parts of the front or the back (a garage step, a deck notch's side).
    else if (prev && prev === next && (prev === "front" || prev === "back") && (facing === "left side" || facing === "right side")) label = `A jog in the ${prev} (faces ${facing.replace(" side", "")})`;
    else {
      const n = (seen.get(facing) ?? 0) + 1;
      seen.set(facing, n);
      label = n === 1 ? `The ${facing}` : `The ${facing}, part ${n}`;
    }
    items.push({ ...base, kind: "wall", label, ...(s.shared ? { shared: true as const } : {}), ...(label === "The front again, back to corner 1" ? { again: true as const } : {}) });
  });
  return items;
}

/**
 * What is still missing, in plain words for beside Finish, or null when nothing is: the walls and the outside corners with
 * no photo (an inside corner needs none: the walls either side show it), no measurement, corners that don't close round.
 */
export function walkMissing(route: PhotoRouteState): string | null {
  const walk = withRingStart(route.walk ?? newWalk());
  const items = ringItems(walk);
  const walls = items.filter((i) => i.kind === "wall" && !i.shared && !i.again && i.photos === 0).map((i) => i.label.replace(/^The /, "the ").replace(/^A /, "a "));
  const corners = items.filter((i) => i.kind === "corner" && i.turn !== "inside" && i.photos === 0).map((i) => `corner ${i.k}`);
  const out: string[] = [];
  const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (walls.length || corners.length) out.push(`No photo yet of ${list([...walls, ...corners])}.`);
  if (!walkHasMeasure(route)) out.push("No measurement yet: one sets the scale for everything, one a wall is better.");
  const t = lapTurns(walk);
  if (!lapCloses(walk)) out.push(t.length < 4 ? "Fewer than four corners so far: say each corner round to the front." : "The corners don't close round to the front yet: a corner missed, or one said inside that sticks out.");
  return out.length ? out.join(" ") : null;
}

// ── The shape from the lap ───────────────────────────────────────────────────────────────────────

/** Plan direction of a side by its quarter turns from the front's (east). */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const dirOf = (h: number) => DIRS[((h % 4) + 4) % 4] as [number, number];

/** Rough sides for the shape from a lap: a wall between two outside corners long, a step beside a notch short. Feet. */
const ROUGH = { across: 40, back: 30, step: 8, notch: 12, least: 2 };

/**
 * The outline a lap makes: one corner each turn, the walk's corner k at outline corner k - 1 (so the plan's numbers are
 * the walk's), the front its last side, running east to corner 0; each side a quarter turned from the last as walked. Sizes are rough and only the turns are the walk's: a wall between two outside corners
 * is taken long (40' across the street's way, 30' back from it), a step to a notch short (8'), a notch's back 12', and
 * each axis then evened out as little as it takes to close (each side moved in proportion to its size, least squares),
 * none under 2'. If that crosses itself, the long walls are taken longer and the steps shorter until it doesn't. Null for
 * a lap that doesn't close (`lapCloses`).
 */
export function lapOutline(turns: number[]): Pt[] | null {
  const m = turns.length;
  if (m < 4 || turns.reduce((s, t) => s + t, 0) !== 4 || turns.some((t) => t !== 1 && t !== -1)) return null;
  // The turn at outline corner c: corner 0 is the walk's last.
  const turnAt = (c: number) => (c === 0 ? (turns[m - 1] as number) : (turns[c - 1] as number));
  const heading: number[] = [0];
  for (let i = 1; i < m; i++) heading.push((heading[i - 1] as number) + turnAt(i));
  for (const [long, short] of [
    [1, 1],
    [1.5, 0.75],
    [2, 0.5],
    [3, 0.4],
  ] as const) {
    const d = heading.map((h, i) => {
      const a = turnAt(i);
      const b = turnAt((i + 1) % m);
      const across = ((h % 2) + 2) % 2 === 0;
      if (a > 0 && b > 0) return (across ? ROUGH.across : ROUGH.back) * long;
      if (a < 0 && b < 0) return ROUGH.notch * short;
      return ROUGH.step * short;
    });
    const L = [...d];
    for (const axis of [0, 1]) {
      const idx = heading.map((h, i) => i).filter((i) => (((heading[i] as number) % 2) + 2) % 2 === axis);
      const sign = (i: number) => (axis === 0 ? dirOf(heading[i] as number)[0] : dirOf(heading[i] as number)[1]);
      // Least squares on each side's change over its size, the axis's signed sum held at zero; any side driven under the
      // least is held there and the rest solved again.
      const fixed = new Set<number>();
      for (let pass = 0; pass <= idx.length; pass++) {
        const free = idx.filter((i) => !fixed.has(i));
        const sum = idx.reduce((s, i) => s + sign(i) * (fixed.has(i) ? ROUGH.least : (d[i] as number)), 0);
        const w = free.reduce((s, i) => s + (d[i] as number) ** 2, 0);
        if (w === 0) break;
        const lambda = sum / w;
        let more = false;
        for (const i of free) {
          const v = (d[i] as number) - lambda * sign(i) * (d[i] as number) ** 2;
          if (v < ROUGH.least) {
            fixed.add(i);
            more = true;
          }
          L[i] = v;
        }
        for (const i of fixed) L[i] = ROUGH.least;
        if (!more) break;
      }
    }
    const ring: Pt[] = [{ x: 0, y: 0 }];
    for (let i = 0; i < m - 1; i++) {
      const p = ring[i] as Pt;
      const [dx, dy] = dirOf(heading[i] as number);
      ring.push({ x: round2(p.x + dx * (L[i] as number)), y: round2(p.y + dy * (L[i] as number)) });
    }
    // Started from the front's left end; numbered from its right, the walk's first corner.
    if (closesAt(ring, heading, L) && simple(ring)) return [...ring.slice(1), ring[0] as Pt];
  }
  return null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The last side comes back to corner 0. */
function closesAt(ring: Pt[], heading: number[], L: number[]): boolean {
  const m = ring.length;
  const p = ring[m - 1] as Pt;
  const [dx, dy] = dirOf(heading[m - 1] as number);
  return Math.hypot(p.x + dx * (L[m - 1] as number), p.y + dy * (L[m - 1] as number)) < 0.05 && L.every((v) => v >= ROUGH.least - 1e-9);
}

/** No two sides that aren't neighbours touch, and the ring runs counter-clockwise. */
function simple(ring: Pt[]): boolean {
  const n = ring.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    area += a.x * b.y - b.x * a.y;
  }
  if (area <= 0) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsTouch(ring[i] as Pt, ring[(i + 1) % n] as Pt, ring[j] as Pt, ring[(j + 1) % n] as Pt)) return false;
    }
  }
  return true;
}

/** Two square-to-the-axes segments meet or come within a hair of it. */
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const eps = 0.05;
  const [ax0, ax1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [ay0, ay1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [cx0, cx1] = [Math.min(c.x, d.x), Math.max(c.x, d.x)];
  const [cy0, cy1] = [Math.min(c.y, d.y), Math.max(c.y, d.y)];
  return ax0 <= cx1 + eps && cx0 <= ax1 + eps && ay0 <= cy1 + eps && cy0 <= ay1 + eps;
}

/** Left (+1) or right (-1) turn at each corner of a counter-clockwise ring; 0 where it runs straight on. */
export function ringTurns(ring: Pt[]): number[] {
  const n = ring.length;
  return ring.map((b, k) => {
    const a = ring[(k - 1 + n) % n] as Pt;
    const c = ring[(k + 1) % n] as Pt;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    return z > 1e-9 ? 1 : z < -1e-9 ? -1 : 0;
  });
}

/**
 * How a lap's corners sit on a shape drawn by hand: the shift r putting the walk's corner k at outline corner k - 1 + r,
 * with every turn the same and the front (the lap's last side, into its first corner) a side facing the street. Null
 * when no shift fits (a corner more or less, a turn said differently). Where more than one fits, the one whose front is
 * nearest the street.
 */
export function alignLap(turns: number[], outline: Pt[]): number | null {
  const m = turns.length;
  if (outline.length !== m || m < 4) return null;
  const drawn = ringTurns(outline);
  let best: { r: number; y: number } | null = null;
  for (let r = 0; r < m; r++) {
    // The walk's corner c + 1 at outline corner c + r.
    if (!turns.every((t, c) => drawn[(c + r) % m] === t)) continue;
    const a = outline[(m - 1 + r) % m] as Pt;
    const b = outline[r % m] as Pt;
    // The front runs east on the plan (the house on its left, walked with the street behind).
    if (!(b.x - a.x > Math.abs(b.y - a.y))) continue;
    const y = Math.min(a.y, b.y);
    if (!best || y < best.y) best = { r, y };
  }
  return best?.r ?? null;
}

// ── The photos' places on the walk ──────────────────────────────────────────────────────────────

/** Every photo of the walk with its tag, in the order taken. */
export function walkPhotos(walk: RouteWalk): { photo: string; tag: WalkTag; stop: number }[] {
  const nums = stopNumbers(walk);
  const out: { photo: string; tag: WalkTag; stop: number }[] = [];
  walk.stops.forEach((s, i) => {
    const k = nums[i] as number;
    // A wall's or an inside corner's photos after the first are more of it (`WalkTag.part`); a corner's 45s are each the corner.
    const part = (j: number) => (j > 0 ? { part: true as const } : {});
    if (s.kind === "front") s.photos.forEach((p, j) => out.push({ photo: p, tag: { role: "front", k: 0, ...part(j) }, stop: i }));
    else if (s.kind === "side") s.photos.forEach((p, j) => out.push({ photo: p, tag: { role: "side", k, ...part(j) }, stop: i }));
    else if (turnOf(s) === "inside") {
      if (insideWalls(s).before !== null) s.photos.forEach((p, j) => out.push({ photo: p, tag: { role: "corner", k, corner: "inside", wall: "before", ...part(j) }, stop: i }));
    } else if (turnOf(s) === "joined") {
      for (const p of s.photos) out.push({ photo: p, tag: { role: "corner", k, corner: "joined", wall: s.auto ? "after" : "before" }, stop: i });
    } else for (const p of s.photos) out.push({ photo: p, tag: { role: "corner", k, corner: "outside" }, stop: i });
  });
  return out;
}

/**
 * Each "more of this wall" photo with its wall's first, the full one (2026-10-23): the close-ups to lay exactly on it
 * (lib/photoRouteMatch.ts), the front's and each side's. A close-up laid so is read at the wall's scale; it sizes nothing.
 */
export function wallCloseUps(walk: RouteWalk): { photo: string; full: string; stop: number }[] {
  return walk.stops.flatMap((s, i) => ((s.kind === "side" || s.kind === "front") && s.photos.length > 1 ? s.photos.slice(1).map((photo) => ({ photo, full: s.photos[0] as string, stop: i })) : []));
}

/**
 * What a photo of the walk names on the outline (`RoutePhoto.shot`), the walk's corner k at outline corner (k - 1 + shift)
 * mod m: a corner's 45 that corner; a side straight on its wall; the front the run of walls from where the walk first came
 * back to facing the street round to the front's right-hand corner - the whole front, with any steps in it; an inside
 * corner's walls that corner, by the order they are tapped (the inside corner first: its place in the photo says nothing).
 */
export function walkShot(tag: WalkTag, walk: RouteWalk, shift = 0): RouteShot | null {
  const t = lapTurns(walk);
  const m = t.length;
  // Part of a wall: which of its corners it shows isn't known, so it names none.
  if (m < 4 || tag.part) return null;
  const at = (k: number) => (((k - 1 + shift) % m) + m) % m;
  if (tag.role === "corner" && tag.corner === "joined") {
    // The open wall, at an angle from this end: the one walked up to it, or the one on from the neighbour's far corner -
    // named as that wall straight on, its two ends left and right as seen from outside.
    return { kind: "wall", index: at(tag.wall === "after" ? tag.k : tag.k - 1) };
  }
  if (tag.role === "corner") return tag.corner === "inside" ? { kind: "inside", index: at(tag.k), wall: tag.wall ?? "before" } : { kind: "corner", index: at(tag.k) };
  if (tag.role === "side") return { kind: "wall", index: at(tag.k) };
  // The front: from the corner where the walk first faced the street again (its left end) to corner 1 (its right).
  let h = 0;
  let left = m;
  for (let k = 1; k <= m; k++) {
    h += t[k - 1] as number;
    if (h === 4) {
      left = k;
      break;
    }
  }
  return left === m ? { kind: "wall", index: at(0) } : { kind: "run", index: at(left), to: at(1) };
}

/**
 * The route with the walk's say in it: each photo of the walk tagged with its place (`RoutePhoto.walk`); and once the lap
 * is closed, the house's shape from it (unless one was drawn by hand: then the lap is laid on that), the walls shared
 * with the neighbour, and each photo's `shot` on the shape. A shape that changes clears the corners' numbers, as drawing
 * it again does; the photos' shots name them again.
 */
export function withWalk(route: PhotoRouteState, walk: RouteWalk): PhotoRouteState {
  const tags = new Map(walkPhotos(walk).map((p) => [p.photo, p.tag]));
  const main: RouteBuilding = route.buildings.find((b) => b.id === "main") ?? { id: "main", outline: [], corners: [], tapes: [] };
  // The home's type is the walk's to say once it has a corner: a corner meeting the neighbour's is a shared wall.
  const homeType = walk.stops.some((s) => s.kind === "corner") ? walkHomeType(walk, main.homeType) : main.homeType;
  const { homeType: _was, ...untyped } = main;
  // A wall's length typed on the walk is its side's tape once the lap is laid on the shape: made again each time.
  let b: RouteBuilding = { ...untyped, ...(homeType ? { homeType } : {}), tapes: main.tapes.filter((t) => !(t.kind === "side" && t.id.startsWith("walk-"))) };
  let shift: number | null = null;
  const turns = lapTurns(walk);
  if (walk.closed && lapCloses(walk)) {
    if (b.outline.length === 0 || isWalkShape(b)) {
      const ring = lapOutline(turns);
      if (ring) {
        const same = b.outline.length === ring.length && b.outline.every((p, i) => Math.hypot(p.x - (ring[i] as Pt).x, p.y - (ring[i] as Pt).y) < 0.01);
        if (!same) b = { ...b, outline: ring, outlineFrom: "walk", corners: b.corners.map(unnumbered) };
        shift = 0;
      }
    } else shift = alignLap(turns, b.outline);
    if (shift !== null) {
      const m = turns.length;
      const nums = stopNumbers(walk);
      const shared = walk.stops.flatMap((s, i) => (s.kind === "side" && s.shared ? [(((nums[i] as number) - 1 + (shift as number)) % m + m) % m] : []));
      b = { ...b, shared: shared.sort((p, q) => p - q), tapes: [...b.tapes, ...wallTapes(walk, shift, new Set(b.tapes.map((t) => t.id)))] };
    }
  }
  const photos = route.photos.map((p): RoutePhoto => {
    const tag = tags.get(p.id);
    const { walk: _w, ...rest } = p;
    if (!tag) {
      // A photo the walk no longer holds keeps no place on it.
      if (!p.walk) return p;
      const { shot: _s, ...plain } = rest;
      return plain;
    }
    const shot = shift === null ? null : walkShot(tag, walk, shift);
    const { shot: _s, ...noShot } = rest;
    return { ...noShot, walk: tag, ...(shot ? { shot } : {}) };
  });
  const buildings = route.buildings.some((x) => x.id === "main") ? route.buildings.map((x) => (x.id === "main" ? b : x)) : [b, ...route.buildings];
  return { ...route, walk, photos, buildings };
}

/**
 * The walls' lengths typed on the walk as side tapes, the walk's corner k at outline corner k - 1 + shift: a side's its own
 * wall; the front's the front, when the front is one wall (a front with steps in it is a run of walls: which one was meant
 * waits for its ends to be placed). A measurement already a tape (its line placed) stands as it is.
 */
function wallTapes(walk: RouteWalk, shift: number, taped: Set<string>): RouteTape[] {
  const m = lapTurns(walk).length;
  const front = walkShot({ role: "front", k: 0 }, walk, shift);
  return walkMeasures(walk).flatMap(({ m: w, kind, k }): RouteTape[] => {
    if (w.what !== "wall" || taped.has(w.id)) return [];
    const from = kind === "side" ? (((k - 1 + shift) % m) + m) % m : kind === "front" && front?.kind === "wall" ? front.index : null;
    return from === null ? [] : [{ id: w.id, kind: "side", from, feet: w.feet }];
  });
}

/**
 * Whether a building's shape is still the one a lap made, sizes and all: marked so, and just what a lap of its own turns
 * makes. Drawn again - in the pane, or by the Scrivn team measuring a request - it is a drawing, and the walk neither
 * replaces it nor has it held loosely (lib/photoRoute.ts `WALK_HOLD`).
 */
export function isWalkShape(b: Pick<RouteBuilding, "outline" | "outlineFrom">): boolean {
  if (b.outlineFrom !== "walk" || b.outline.length < 4) return false;
  const ring = lapOutline(ringTurns(b.outline));
  return !!ring && ring.length === b.outline.length && ring.every((p, i) => Math.hypot(p.x - (b.outline[i] as Pt).x, p.y - (b.outline[i] as Pt).y) < 0.05);
}

/** A corner tap whose number the shape no longer says: numbered again, by its photo's shot or the app. */
function unnumbered(c: CornerTap): CornerTap {
  const { by: _by, ...rest } = c;
  return { ...rest, corner: -1 };
}

/** The route with photos taken out (`walkBack`'s dropped, a retake's old one): their corner taps and measurements with them. */
export function withoutPhotos(route: PhotoRouteState, ids: string[]): PhotoRouteState {
  if (ids.length === 0) return route;
  const gone = new Set(ids);
  return {
    ...route,
    photos: route.photos.filter((p) => !gone.has(p.id)),
    buildings: route.buildings.map((b) => ({
      ...b,
      corners: b.corners.filter((c) => !gone.has(c.photo)),
      tapes: b.tapes.filter((t: RouteTape) => !(t.kind === "line" && gone.has(t.photo))),
    })),
  };
}

/** The sides walked as shared with the neighbour (a joined corner's), by outline side index on the lap's own shape. */
export function walkSharedSides(walk: RouteWalk): number[] {
  const m = lapTurns(walk).length;
  const nums = stopNumbers(walk);
  return walk.stops.flatMap((s, i) => (s.kind === "side" && s.shared && m > 0 ? [((((nums[i] as number) - 1) % m) + m) % m] : []));
}

/** At least one measurement, typed on the walk or a tape: what sets the size. The walk doesn't finish without one. */
export function walkHasMeasure(route: PhotoRouteState): boolean {
  return walkMeasures(route.walk ?? newWalk()).length > 0 || route.buildings.some((b) => b.id === "main" && b.tapes.length > 0);
}

/** The walk's measurements not a tape yet: a line still to place on its photo (a wall's length is its side's tape). */
export function walkUnplaced(route: PhotoRouteState): { m: WalkMeasure; stop: number; kind: WalkStop["kind"]; k: number }[] {
  const tapes = new Set(route.buildings.find((b) => b.id === "main")?.tapes.map((t) => t.id) ?? []);
  return walkMeasures(route.walk ?? newWalk()).filter(({ m }) => !tapes.has(m.id));
}

/** A measurement in words, to the eighth it was typed to: "Garage door 16'", "Wall 42'6"", "Window 5'11¾"". */
export function measureWords(m: Pick<WalkMeasure, "what" | "feet">): string {
  return `${MEASURE_LABEL[m.what]} ${feetInchesEighths(m.feet)}`;
}

const EIGHTHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];

/** Feet, inches and an eighth: 5'11¾", 9', 0'4½". formatFeetInches rounds to the inch, which would show 5'11¾" as 6'. */
export function feetInchesEighths(feet: number): string {
  if (!Number.isFinite(feet) || feet < 0) return formatFeetInches(feet);
  const total = Math.round(feet * 96);
  const ft = Math.floor(total / 96);
  const inch = Math.floor((total % 96) / 8);
  const e = total % 8;
  return inch === 0 && e === 0 ? `${ft}'` : `${ft}'${inch}${EIGHTHS[e]}"`;
}

const MEASURE_LABEL: Record<TapeWhat, string> = { garage: "Garage door", door: "Door", window: "Window", wall: "Wall", other: "Other" };

/** The walk in numbers, for the end of it: photos, corners (inside and joined), sides passed by, measurements. */
export function walkSummary(route: PhotoRouteState): { photos: number; corners: number; inside: number; joined: number; sidesSkipped: number; measures: number } {
  const walk = route.walk ?? newWalk();
  const corners = walk.stops.filter((s) => s.kind === "corner");
  return {
    photos: walkPhotos(walk).length,
    corners: corners.length,
    inside: corners.filter((s) => s.turn === "inside").length,
    joined: corners.filter((s) => s.turn === "joined").length,
    sidesSkipped: walk.stops.filter((s) => s.kind === "side" && !s.shared && s.photos.length === 0).length,
    measures: new Set([...walkMeasures(walk).map(({ m }) => m.id), ...(route.buildings.find((b) => b.id === "main")?.tapes.map((t) => t.id) ?? [])]).size,
  };
}

/** What a photo of the walk is, in words: "the front", "corner 2 at 45°", "the back (side 2)", "the wall before inside corner 4". */
export function walkPhotoWords(tag: WalkTag, walk: RouteWalk): string {
  if (tag.part) return `more of ${walkPhotoWords({ ...tag, part: undefined }, walk)}`;
  if (tag.role === "front") return "the front";
  if (tag.role === "corner" && tag.corner === "joined") return `the ${facingWords(headingBefore(walk, tag.wall === "after" ? tag.k : tag.k - 1))} at an angle, from where it meets the neighbour's`;
  if (tag.role === "corner") return tag.corner === "inside" ? `the wall ${tag.wall === "after" ? "on from" : "up to"} inside corner ${tag.k}` : `corner ${tag.k} at 45°`;
  return `the ${facingWords(headingBefore(walk, tag.k))} (side ${tag.k})`;
}

/** The quarter turns walked before side k: through corner k. */
export function headingBefore(walk: RouteWalk, k: number): number {
  let h = 0;
  let seen = 0;
  for (const s of walk.stops) {
    if (s.kind !== "corner") continue;
    seen += 1;
    if (seen > k) break;
    h += quarter(turnOf(s));
  }
  return h;
}

/**
 * What to tap on a photo of the walk, once it is back at the front and measured here: by what the photo was taken for.
 * An inside corner's wall is asked for the inside corner first - its place in the photo says nothing of which it is.
 */
export function walkTapWords(tag: WalkTag, attached: boolean): string {
  if (tag.part) return "Tap each corner of the house you can see on it, where it meets the ground. The first asks which corner it is.";
  if (tag.role === "front") return `Tap each corner of the front you can see, where it meets the ground${attached ? ", and where this home ends" : ""}.`;
  if (tag.role === "side") return "Tap both its corners where they meet the ground.";
  if (tag.corner === "inside") return `Tap inside corner ${tag.k} first, where it meets the ground; then the wall's other corner if it's in.`;
  if (tag.corner === "joined") return "Tap each end of the wall where it meets the ground: where this home ends, and its corner.";
  return `Tap corner ${tag.k} where it meets the ground, then the far end of each of its two walls if you can see it.`;
}

// ── A walk said in words (2026-10-22, cleaner input) ────────────────────────────────────────────────

/**
 * A walk said afterwards in words - the house runner's `walk` in inputs.json, from the tester's walk.txt - as the walk
 * itself would hold it: the front, then each corner as turned (corner 1 the front's right-hand end) and the wall after it,
 * back to the front. Its corners are the house's outline (`lapOutline`), so nobody guesses the shape from the photos.
 */
export function walkFromTurns(turns: WalkTurn[]): RouteWalk {
  const stops: WalkStop[] = [{ kind: "front", photos: [] }];
  turns.forEach((turn, i) => {
    stops.push({ kind: "corner", turn, photos: [] });
    if (i < turns.length - 1) stops.push({ kind: "side", photos: [] });
  });
  return { stops, closed: true };
}

/** "O O I O" / "outside, inside" / "OOIO": each corner's turn, in order; J (or "joins") meets the neighbour's. Null when a word isn't one. */
export function parseTurns(said: string | string[]): WalkTurn[] | null {
  const words = Array.isArray(said) ? said : /[\s,;]/.test(said.trim()) ? said.trim().split(/[\s,;]+/) : said.trim().split("");
  const out: WalkTurn[] = [];
  for (const w of words.filter(Boolean)) {
    const t = w.toLowerCase();
    if (t === "o" || t === "out" || t === "outside") out.push("outside");
    else if (t === "i" || t === "in" || t === "inside") out.push("inside");
    else if (t === "j" || t === "joins" || t === "joined") out.push("joined");
    else return null;
  }
  return out;
}

/**
 * What a photo was taken for, said in words - "corner 3", "side 2", "the front", "far corner 1", "far back" - as its shot on
 * the outline (the walk's corner k at outline corner k - 1 + shift) and its walk tag. A photo of the walk itself ("corner
 * 3": taken there, close, the corner in the middle) is tagged, and its corners named as the walk names them. One taken
 * "far" back is not: it shows whichever corners it shows, round the one it was taken for (`RouteShot.far`), and they are
 * named by fitting it on the shape, the corner it was for among them. "back" is the run of walls facing away from the
 * street. Null for words it can't read, or a corner or side the walk hasn't. `farAlways` takes every role so (the house
 * runner, 2026-10-22): on a test house's walk photos the corner a photo was taken for was the middle tap on none of them
 * (a "corner 1" framed the whole garage front), so a role says which corner is in a photo, not which tap it is.
 */
export function roleShot(role: string, walk: RouteWalk, shift = 0, opts: { farAlways?: boolean } = {}): { shot: RouteShot; tag: WalkTag | null } | null {
  const m = /^\s*(far(?:\s+back)?\s+)?(?:the\s+)?(front|back|corner\s+(\d+)|side\s+(\d+))\s*$/i.exec(role);
  if (!m) return null;
  const far = !!m[1] || !!opts.farAlways;
  const turns = lapTurns(walk);
  const n = turns.length;
  if (n < 4) return null;
  const at = (k: number) => (((k - 1 + shift) % n) + n) % n;
  const what = (m[2] as string).toLowerCase();
  if (what === "back") {
    const ring = lapOutline(turns);
    if (!ring) return null;
    const run = facingRun(ring, shift, 2);
    return run ? { shot: { kind: "run", index: run[0], to: run[1], far: true }, tag: null } : null;
  }
  if (what === "front") {
    const tag: WalkTag = { role: "front", k: 0 };
    const shot = walkShot(tag, walk, shift);
    if (!shot) return null;
    return far ? { shot: shot.kind === "run" ? { ...shot, far: true } : shot, tag: null } : { shot, tag };
  }
  const k = Number(m[3] ?? m[4]);
  if (!(k >= 1 && k <= n)) return null;
  if (m[3] !== undefined) {
    const turn: WalkTurn = (turns[k - 1] as number) < 0 ? "inside" : "outside";
    if (far) return { shot: { kind: "corner", index: at(k), far: true }, tag: null };
    const tag: WalkTag = { role: "corner", k, corner: turn, ...(turn === "inside" ? { wall: "before" as const } : {}) };
    const shot = walkShot(tag, walk, shift);
    return shot ? { shot, tag } : null;
  }
  const tag: WalkTag = { role: "side", k };
  const shot = walkShot(tag, walk, shift);
  return shot ? { shot, tag: far ? null : tag } : null;
}

/**
 * The run of walls of a lap-made [ring] facing one way - 2 the back (y grows), 0 the front - from its first such wall's start
 * to its last's end, round the ring the way it runs, through no wall facing the other way; outline corners (shifted).
 */
function facingRun(ring: Pt[], shift: number, way: 0 | 2): [number, number] | null {
  const n = ring.length;
  const faces = ring.map((a, i) => {
    const b = ring[(i + 1) % n] as Pt;
    // Counter-clockwise: a wall running west faces north (the back), one running east faces south (the front).
    return b.x < a.x - 1e-6 ? 2 : b.x > a.x + 1e-6 ? 0 : -1;
  });
  let best: [number, number] | null = null;
  for (let s = 0; s < n; s++) {
    if (faces[s] !== way || faces[(s - 1 + n) % n] === way) continue;
    let e = s;
    for (let j = 1; j < n; j++) {
      const i = (s + j) % n;
      if (faces[i] === (way === 2 ? 0 : 2)) break;
      if (faces[i] === way) e = i;
    }
    const len = (e - s + n) % n;
    if (!best || len > (best[1] - best[0] + n) % n) best = [s, e];
  }
  if (!best) return null;
  // The lap's ring has the walk's corner k at index k - 1; with the shift, at k - 1 + shift.
  return [(((best[0] + shift) % n) + n) % n, (((best[1] + 1 + shift) % n) + n) % n];
}
