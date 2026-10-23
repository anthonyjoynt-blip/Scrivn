/**
 * The walk's close-ups through a measure (2026-10-23): which to lay on their walls, what an earlier measure found that still
 * holds, and each match put on the exterior as it comes. The matching itself (lib/photoRouteMatch.ts, 5-15 seconds a pair
 * on a PC) runs in a web worker after Measure (`runMatchJob`, lib/photoRouteMatchWorker.ts), so the page stays responsive;
 * a close-up laid by hand (4 points tapped on both, `RoutePhoto.taps`) is laid at once.
 *
 * A wall is flat, so the match - one homography from the close-up's pixels to its wall's full photo's - holds whatever the
 * measure does: a later measure keeps it, unless the lens's radial term it was found at has moved. Laid or not, a close-up
 * sizes nothing: it is read at the wall's scale, which the photos with corners and the tapes set.
 */

import type { Exterior } from "./exterior";
import { emptyPhotoRoute, type PhotoRouteState, ROUTE_MATCH_V, type RouteMatch, type RouteMeasured } from "./photoRoute";
import { photoLines } from "./photoRouteData";
import { exteriorFromRoute } from "./photoRouteExterior";
import { levelPhotos, type PhotoCamera } from "./photoRouteLens";
import { grayFrom, type Gray } from "./photoRouteLines";
import { type DetailMatch, matchDetail, matchFromTaps, type MatchPhoto } from "./photoRouteMatch";
import type { Mat3 } from "./photoRouteMath";
import { wallCloseUps } from "./photoRouteWalk";

/** A match found at a radial term this near the measure's still holds (as measureRoute levels again past it). */
const SAME_K = 0.003;

export interface CloseUpPair {
  photo: string;
  full: string;
}

/** The close-ups to lay: each of the walk's "more of this wall" photos with its wall's first, both on the route. */
export function closeUpPairs(route: Pick<PhotoRouteState, "walk" | "photos">): CloseUpPair[] {
  if (!route.walk) return [];
  const on = new Set(route.photos.map((p) => p.id));
  return wallCloseUps(route.walk)
    .filter((c) => on.has(c.photo) && on.has(c.full))
    .map(({ photo, full }) => ({ photo, full }));
}

/** A match as kept on the measure, from matchDetail's or matchFromTaps's: null, not laid, with why. */
export function routeMatch(pair: CloseUpPair, match: DetailMatch | null, words: string, k: number, by: RouteMatch["by"] = match?.by ?? "code"): RouteMatch {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    v: ROUTE_MATCH_V,
    photo: pair.photo,
    full: pair.full,
    h: match ? [...match.h] : null,
    by,
    points: match?.points ?? 0,
    inliers: match?.inliers ?? 0,
    rmsPx: match ? r2(match.rmsPx) : 0,
    zoom: match ? r2(match.zoom) : 0,
    onFull: match ? match.pairs.map((p) => [r2(p.f[0]), r2(p.f[1])] as [number, number]) : [],
    words,
    k,
  };
}

/** A photo's size and radial term as the measure has it: placed, its lens; else the photo with the measure's term. */
function lensOf(route: Pick<PhotoRouteState, "photos">, m: Pick<RouteMeasured, "lenses" | "k">, id: string): { width: number; height: number; k: number } | null {
  const lens = m.lenses[id];
  if (lens) return { width: lens.width, height: lens.height, k: m.k };
  const p = route.photos.find((q) => q.id === id);
  return p ? { width: p.width, height: p.height, k: m.k } : null;
}

/** A close-up laid from the 4 or more points tapped on both: its match, or null with why. */
export function tapsMatch(route: Pick<PhotoRouteState, "photos">, m: Pick<RouteMeasured, "lenses" | "k">, pair: CloseUpPair, points: readonly (readonly [number, number, number, number])[]): RouteMatch {
  const d = lensOf(route, m, pair.photo);
  const f = lensOf(route, m, pair.full);
  const mt = d && f ? matchFromTaps(points, d, f) : null;
  const words = mt
    ? `Laid on its wall from your ${points.length} points.`
    : points.length < 4
      ? "Tap 4 points on both photos."
      : "Those points don't hold a wall: tap 4 again, spread out, on the wall's face, three never in a line.";
  return routeMatch(pair, mt, words, m.k, "taps");
}

/**
 * The matches a new measure [m] keeps, and the close-ups left to lay in code: each pair's taps laid at once; else what an
 * earlier measure found for it in code (laid or not) at nearly the same radial term; the rest to do.
 */
export function matchesForMeasure(route: Pick<PhotoRouteState, "walk" | "photos">, prev: readonly RouteMatch[] | undefined, m: Pick<RouteMeasured, "lenses" | "k">): { matches: RouteMatch[]; todo: CloseUpPair[] } {
  const matches: RouteMatch[] = [];
  const todo: CloseUpPair[] = [];
  for (const pair of closeUpPairs(route)) {
    const taps = route.photos.find((p) => p.id === pair.photo)?.taps;
    if (taps && taps.full === pair.full && taps.points.length >= 4) {
      matches.push(tapsMatch(route, m, pair, taps.points));
      continue;
    }
    const before = (prev ?? []).find((x) => x.v === ROUTE_MATCH_V && x.by === "code" && x.photo === pair.photo && x.full === pair.full && Math.abs(x.k - m.k) < SAME_K);
    if (before) matches.push(before);
    else todo.push(pair);
  }
  return { matches, todo };
}

/** The close-ups of the walk not laid or tried at this measure's lens: what "Lay them on their walls" does. */
export function closeUpsToLay(route: Pick<PhotoRouteState, "walk" | "photos">, m: Pick<RouteMeasured, "lenses" | "k" | "matches">): CloseUpPair[] {
  return matchesForMeasure(route, m.matches, m).todo;
}

/**
 * A match put on the exterior, found after the measure [at]: in place of any for the same close-up, the close-up laid on
 * its side (the exterior made again from the same measure: each side keeps its id and what was put on it). Unchanged when
 * the measure has moved on since.
 */
export function withRouteMatch(e: Exterior, at: string, match: RouteMatch): Exterior {
  return withRouteMatches(e, at, [match]);
}

export function withRouteMatches(e: Exterior, at: string, found: readonly RouteMatch[]): Exterior {
  const route = e.photoRoute;
  const m = route?.measured;
  if (!route || !m || m.at !== at || found.length === 0) return e;
  const matches = [...(m.matches ?? []).filter((x) => !found.some((f) => f.photo === x.photo)), ...found];
  const next: RouteMeasured = { ...m, matches };
  return exteriorFromRoute(e, route, next) ?? { ...e, photoRoute: { ...route, measured: next } };
}

/**
 * A close-up's 4 points tapped on both (`RoutePhoto.taps`), kept on the route and, measured, the close-up laid from them at
 * once. Null [points]: the taps taken away, and the match they made with them (code lays it again, or says it can't).
 */
export function withCloseUpTaps(e: Exterior, pair: CloseUpPair, points: [number, number, number, number][] | null): Exterior {
  const route = e.photoRoute ?? emptyPhotoRoute();
  const photos = route.photos.map((p) => {
    if (p.id !== pair.photo) return p;
    const { taps: _old, ...rest } = p;
    return points ? { ...rest, taps: { full: pair.full, points } } : rest;
  });
  const withTaps: Exterior = { ...e, photoRoute: { ...route, photos } };
  const m = route.measured;
  if (!m) return withTaps;
  if (points) return withRouteMatch(withTaps, m.at, tapsMatch({ photos }, m, pair, points));
  const matches = (m.matches ?? []).filter((x) => !(x.photo === pair.photo && x.by === "taps"));
  const next: RouteMeasured = { ...m, matches };
  const r = withTaps.photoRoute as PhotoRouteState;
  return exteriorFromRoute(withTaps, r, next) ?? { ...withTaps, photoRoute: { ...r, measured: next } };
}

// ── The matching, for a web worker ───────────────────────────────────────────────────────────────

/** A photo to match: its grey and lens as the measure had them; or its pixels, to grey and to level with the measure's lens. */
export interface MatchJobPhoto {
  gray?: Gray;
  rgba?: { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number };
  camera: PhotoCamera | null;
  /** The measure's lens, to level a photo it did not place (a close-up): f over the width and the radial term. */
  level: { focalOverWidth: number; k: number };
  focalPrior?: number | null;
}

export interface MatchJob {
  photos: Record<string, MatchJobPhoto>;
  pairs: CloseUpPair[];
  /** The measure's radial term: what the matches are found at. */
  k: number;
}

export type MatchJobMessage = { kind: "start"; photo: string; index: number; of: number } | { kind: "result"; match: RouteMatch } | { kind: "done" } | { kind: "error"; words: string };

/** A camera as the measure keeps it (`RouteMeasured.lenses`), at the measure's radial term. */
export function cameraFrom(lens: RouteMeasured["lenses"][string], k: number): PhotoCamera {
  return { width: lens.width, height: lens.height, f: lens.f, k, R: [...lens.R] as Mat3 };
}

/**
 * Each pair matched in turn, every result sent as it is found (`post`): what the worker does, and the tests. A photo is
 * made ready once - greyed and levelled when it came as pixels - however many close-ups it is the full photo of.
 */
export function runMatchJob(job: MatchJob, post: (msg: MatchJobMessage) => void): void {
  const ready = new Map<string, MatchPhoto>();
  const photoOf = (id: string): MatchPhoto | null => {
    const had = ready.get(id);
    if (had) return had;
    const p = job.photos[id];
    if (!p) return null;
    let gray = p.gray ?? null;
    let camera = p.camera;
    if (p.rgba && (!gray || !camera)) {
      if (camera) gray = grayFrom(p.rgba.data, p.rgba.width, p.rgba.height, p.rgba.channels, 1);
      else {
        const lines = photoLines({ id, ...p.rgba });
        gray = lines.gray;
        const level = levelPhotos([{ width: p.rgba.width, height: p.rgba.height, segments: lines.segments, focalPrior: p.focalPrior ?? null, regions: null }], { fitLens: false, focalOverWidth: p.level.focalOverWidth, k: p.level.k });
        camera = level.cameras[0] ?? null;
      }
    }
    if (!gray) return null;
    const made = { gray, camera };
    ready.set(id, made);
    return made;
  };
  job.pairs.forEach((pair, index) => {
    post({ kind: "start", photo: pair.photo, index, of: job.pairs.length });
    const d = photoOf(pair.photo);
    const f = photoOf(pair.full);
    const r = d && f ? matchDetail(d, f) : { match: null, words: "The photos could not be read: tap 4 points on both." };
    post({ kind: "result", match: routeMatch(pair, r.match, r.words, job.k) });
  });
  post({ kind: "done" });
}
