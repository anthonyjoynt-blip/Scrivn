/**
 * The photo route's photos made ready for the solve (2026-10-16): each photo's straight edges, its
 * lens and level, and its upright edges - the same steps in the browser and in the test, from the
 * decoded pixels.
 *
 * The lens is fitted on the photos with corners tapped, each only between its corners (a margin
 * either side): what is outside them - a neighbour's house, a trailer at an angle - pulled a photo's
 * turn by degrees on the owner's #14 (the proof drew those boxes by hand). The other photos (a
 * close-up, the photo of a tape) are levelled with that lens afterwards, so they cannot bend it.
 */

import { DEFAULT_RADIAL_K, levelPhotos, type LevelResult, type PhotoCamera, type PhotoLines } from "./photoRouteLens";
import { grayFrom, lineSegments, type Gray, type Segment } from "./photoRouteLines";
import { uprightEdges } from "./photoRouteEdges";
import { type CornerTap, numberCorners, type PhotoRouteInput, proposeCorners, type RoutePhotoData, type RouteSolution, solveRoute, type SolveRouteOptions } from "./photoRoute";

export interface PhotoPixelsIn {
  id: string;
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

export interface PreparedPhotos {
  data: RoutePhotoData[];
  level: LevelResult;
  segments: Segment[][];
}

/** A photo's grey and straight edges: the slow part (about a third of a second a photo), done once per photo. */
export function photoLines(p: PhotoPixelsIn): { gray: Gray; segments: Segment[] } {
  const gray = grayFrom(p.data, p.width, p.height, p.channels, 1);
  return { gray, segments: lineSegments(gray, 20, { density: 0.5 }) };
}

/** Where the house is in each photo: between its corner taps, with a margin of 8% of its width either side (30% round a lone tap). */
export function houseRegions(input: PhotoRouteInput, id: string, width: number, height: number): [number, number, number, number][] | null {
  const xs = input.buildings.flatMap((b) => b.corners.filter((c) => c.photo === id).map((c) => c.x));
  if (xs.length === 0) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const m = xs.length === 1 ? 0.3 * width : 0.08 * width;
  return [[Math.max(0, lo - m), 0, Math.min(width, hi + m), height]];
}

export function preparePhotos(input: PhotoRouteInput, pixels: PhotoPixelsIn[], lines?: { gray: Gray; segments: Segment[] }[], lens?: { focalOverWidth?: number; k?: number }): PreparedPhotos {
  const ls = lines ?? pixels.map(photoLines);
  const regions = pixels.map((p) => houseRegions(input, p.id, p.width, p.height));
  const withTaps = pixels.map((_, i) => i).filter((i) => regions[i] !== null);
  const rest = pixels.map((_, i) => i).filter((i) => regions[i] === null);
  const focal = (id: string) => input.photos.find((q) => q.id === id)?.focalPrior ?? null;
  const asLines = (i: number, withRegion: boolean): PhotoLines => ({
    width: (pixels[i] as PhotoPixelsIn).width,
    height: (pixels[i] as PhotoPixelsIn).height,
    segments: (ls[i] as { segments: Segment[] }).segments,
    focalPrior: focal((pixels[i] as PhotoPixelsIn).id),
    regions: withRegion ? regions[i] : null,
  });
  const first = levelPhotos(withTaps.map((i) => asLines(i, true)), { k: DEFAULT_RADIAL_K, ...(lens ?? {}) });
  const second = rest.length ? levelPhotos(rest.map((i) => asLines(i, false)), { fitLens: false, focalOverWidth: first.focalOverWidth, k: first.k }) : null;
  const cameras: (PhotoCamera | null)[] = pixels.map(() => null);
  const notes: (string | null)[] = pixels.map(() => null);
  const counts: LevelResult["counts"] = pixels.map(() => null);
  withTaps.forEach((i, j) => {
    cameras[i] = first.cameras[j] ?? null;
    notes[i] = first.notes[j] ?? null;
    counts[i] = first.counts[j] ?? null;
  });
  rest.forEach((i, j) => {
    cameras[i] = second?.cameras[j] ?? null;
    notes[i] = second?.notes[j] ?? null;
    counts[i] = second?.counts[j] ?? null;
  });
  const data: RoutePhotoData[] = pixels.map((p, i) => {
    const cam = cameras[i] ?? null;
    const gray = (ls[i] as { gray: Gray }).gray;
    return { id: p.id, camera: cam, gray, edges: cam ? uprightEdges(gray, cam, (ls[i] as { segments: Segment[] }).segments) : [] };
  });
  return { data, level: { cameras, focalOverWidth: first.focalOverWidth, k: first.k, counts, notes }, segments: ls.map((l) => l.segments) };
}

/**
 * The whole measure: the photos levelled with the lens from their straight edges, the plan solved
 * (fitting the lens's radial term again from the bearings), then the photos levelled once more with
 * that term held and the plan solved from them. The vanishing points alone set the term badly on the
 * owner's photos (-0.08 against the bearings' -0.02, 2026-10-16), and a photo levelled with the wrong
 * term is turned a little wrong as well.
 */
export function measureRoute(
  input: PhotoRouteInput,
  buildingId: string,
  pixels: PhotoPixelsIn[],
  opts: { lines?: { gray: Gray; segments: Segment[] }[]; solve?: SolveRouteOptions } = {},
): { prepared: PreparedPhotos; solution: RouteSolution; firstK: number; corners: CornerTap[]; proposals: CornerTap[] } {
  const lines = opts.lines ?? pixels.map(photoLines);
  const first = preparePhotos(input, pixels, lines);
  // The corners the user did not number, numbered on the shape drawn; then again on the shape measured.
  const withCorners = (corners: CornerTap[]): PhotoRouteInput => ({ ...input, buildings: input.buildings.map((b) => (b.id === buildingId ? { ...b, corners } : b)) });
  const once = withCorners(numberCorners(input, buildingId, first.data));
  // The lens, and the shape the rest of the corners are numbered on, from the photos placed by their corners alone: not
  // the ones placed where the user stood, a few feet out yet (2026-10-20, the runner's taps: with #3 where he stood the
  // rough shape moved enough to number the garage photo's far corner as the bay step's, and the house came out 65% big).
  const byCorners = { ...once, photos: once.photos.map(({ standAt, ...p }) => (void standAt, p)) };
  const rough = solveRoute(byCorners, buildingId, first.data, { ...opts.solve, guesses: false });
  const k = rough.solution.k;
  const prepared = Math.abs(k - first.level.k) < 0.003 ? first : preparePhotos(once, pixels, lines, { k });
  const corners = numberCorners(once, buildingId, prepared.data, rough.corners);
  const solution = solveRoute(withCorners(corners), buildingId, prepared.data, opts.solve);
  // The corners the measure expects on each placed photo and nobody tapped, for the user to keep (2026-10-17).
  const proposals = proposeCorners(withCorners(corners), buildingId, prepared.data, solution);
  return { prepared, solution, firstK: first.level.k, corners, proposals };
}
