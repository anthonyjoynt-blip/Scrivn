/**
 * Where the photo route lands (2026-10-16): a measure becomes the claim's `Sketch.exterior`, as Scan's
 * exterior and the hand-drawn one do, so the elevations, the 3D view, the roof and the report all work
 * from it unchanged.
 *
 *   * the solved corners make the outline, and the outline the sides (lib/exteriorPlan.ts
 *     `exteriorFromOutline`: names by the way each faces, the front the one nearest the street);
 *   * each side takes its length and its ± (`ExteriorSide.lengthPlusMinusPct`; none on a taped side);
 *   * each side takes the photos that saw it best, laid on it by the solved camera: a `SidePhoto`
 *     whose `to_photo` is K R [along | up | origin], with the lens's radial term kept on the camera, so
 *     SidePhotos.tsx squares it up and the AI trace reads it as it reads a photo from Scan;
 *   * measured again, each side keeps its id, and what was put on it (openings, materials, heights)
 *     stays, stretched with its length.
 *
 * Pure: the editor and the tests make the same exterior from the same measure.
 */

import { defaultRoof, type Exterior, type ExteriorSide, type SidePhoto } from "./exterior";
import { exteriorFromOutline, orthogonalRing } from "./exteriorPlan";
import type { PhotoRouteState, RouteCamera, RouteMeasured, RoutePhotoData, RouteSolution } from "./photoRoute";
import type { Pt } from "./roof";
import { formatFeetInches } from "./sketch";

const FOOT_M = 0.3048;
const GDIR: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** A measure as kept on the route: the solve's results and each placed photo's lens and turn. */
export function measuredFrom(sol: RouteSolution, data: RoutePhotoData[], at: string): RouteMeasured {
  const lenses: RouteMeasured["lenses"] = {};
  for (const c of sol.cameras) {
    const cam = data.find((d) => d.id === c.photo)?.camera;
    if (cam) lenses[c.photo] = { f: cam.f, k: sol.solution.k || cam.k, R: [...cam.R], width: cam.width, height: cam.height };
  }
  const anyCam = data.find((d) => d.camera)?.camera;
  return {
    at,
    building: sol.building,
    focalOverWidth: anyCam ? anyCam.f / anyCam.width : 0,
    k: sol.solution.k,
    rms: sol.rms,
    corners: sol.corners.map((p) => ({ x: p.x, y: p.y })),
    sides: sol.sides.map(({ sdFeet: _sd, ...rest }) => rest),
    cameras: sol.cameras,
    unplaced: sol.unplaced,
    advice: sol.advice,
    counts: sol.counts,
    lenses,
  };
}

/** A plan direction in a photo's own (X, Z) frame: `planDirection` (lib/photoRouteSolve.ts) run backwards. */
function toLocal(v: [number, number], quadrant: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const d0 = c * v[0] - s * v[1];
  const d1 = s * v[0] + c * v[1];
  const Z = GDIR[((quadrant % 4) + 4) % 4] as [number, number];
  const X: [number, number] = [Z[1], -Z[0]];
  return [d0 * X[0] + d1 * X[1], d0 * Z[0] + d1 * Z[1]];
}

/**
 * The photo laid on the side from A to B (plan feet; A its left end as seen from outside), from where
 * its camera stood: `to_photo` from the side's (along, up) in metres - up from the ground under the
 * camera - to the photo's pixel as a straight camera would put it; the radial term rides on `camera.k`.
 * Null when the side's middle is behind the camera or out of the picture.
 */
export function sidePhotoFor(lens: RouteMeasured["lenses"][string], rc: RouteCamera, A: Pt, B: Pt, n: number, claimPhotoId: string): SidePhoto | null {
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  if (!(L > 0.1)) return null;
  const yaw = (rc.yawTweakDeg * Math.PI) / 180;
  const u = toLocal([(B.x - A.x) / L, (B.y - A.y) / L], rc.quadrant, yaw);
  const o = toLocal([A.x - rc.at[0], A.y - rc.at[1]], rc.quadrant, yaw);
  const h = rc.heightFeet ?? 5;
  // Columns in the house frame (X, Y up, Z), in feet: per metre along, per metre up, and the side's left end at its ground.
  const M = [
    [u[0] / FOOT_M, 0, o[0]],
    [0, 1 / FOOT_M, -h],
    [u[1] / FOOT_M, 0, o[1]],
  ];
  const R = lens.R;
  const RM = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (R[i * 3] as number) * (M[0] as number[])[j]! + (R[i * 3 + 1] as number) * (M[1] as number[])[j]! + (R[i * 3 + 2] as number) * (M[2] as number[])[j]!));
  const cx = lens.width / 2;
  const cy = lens.height / 2;
  const f = lens.f;
  const H = [
    f * RM[0]![0]! + cx * RM[2]![0]!,
    f * RM[0]![1]! + cx * RM[2]![1]!,
    f * RM[0]![2]! + cx * RM[2]![2]!,
    f * RM[1]![0]! + cy * RM[2]![0]!,
    f * RM[1]![1]! + cy * RM[2]![1]!,
    f * RM[1]![2]! + cy * RM[2]![2]!,
    RM[2]![0]!,
    RM[2]![1]!,
    RM[2]![2]!,
  ];
  const at = (a: number, z: number) => {
    const w = H[6]! * a + H[7]! * z + H[8]!;
    return { x: (H[0]! * a + H[1]! * z + H[2]!) / w, y: (H[3]! * a + H[4]! * z + H[5]!) / w, w };
  };
  const midA = (L * FOOT_M) / 2;
  const mid = at(midA, 1.5);
  if (!(Math.abs(mid.w) > 1e-9)) return null;
  // Divided through so w is 1 at the side's middle, positive in front, as Scan sends it.
  const norm = mid.w;
  const toPhoto = H.map((v) => v / norm);
  const inPic = (p: { x: number; y: number; w: number }) => p.w / norm > 0 && p.x >= 0 && p.y >= 0 && p.x < lens.width && p.y < lens.height;
  if (!inPic(mid)) return null;
  let fromM = Infinity;
  let toM = -Infinity;
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * L * FOOT_M;
    if (inPic(at(a, 0.05))) {
      fromM = Math.min(fromM, a);
      toM = Math.max(toM, a);
    }
  }
  const inView = Number.isFinite(fromM) ? { fromM, toM, leftEnd: inPic(at(0.02, 0.05)), rightEnd: inPic(at(L * FOOT_M - 0.02, 0.05)), top: inPic(at(midA, 3)) } : null;
  return {
    n,
    scanId: null,
    claimPhotoId,
    camera: { width: lens.width, height: lens.height, fx: f, fy: f, cx, cy, k: lens.k },
    toPhoto,
    inView,
  };
}

/** The wall of a counter-clockwise ring that exteriorFromOutline makes the front: facing the street, nearest it, the longest of those level with it. */
function frontIndex(ring: Pt[]): number {
  const n = ring.length;
  let front = -1;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    if (!(b.x - a.x > 1e-6 && Math.abs(b.y - a.y) < 1e-6)) continue;
    if (front < 0) {
      front = i;
      continue;
    }
    const fa = ring[front] as Pt;
    const fb = ring[(front + 1) % n] as Pt;
    if (a.y < fa.y - 1e-6 || (Math.abs(a.y - fa.y) < 1e-6 && b.x - a.x > fb.x - fa.x + 1e-6)) front = i;
  }
  return front;
}

/**
 * The exterior from a measure: as `exteriorFromOutline` makes it from the solved corners, each side
 * with its ± and its photos, the route kept on it. [prev] is the exterior as it was: its roof and
 * scope stay, and a side measured before keeps its id and what was put on it. Null when the measured
 * corners do not make an outline (a side solved to nothing: a corner numbered wrong).
 */
export function exteriorFromRoute(prev: Exterior | undefined, state: PhotoRouteState, m: RouteMeasured, eaveFeet = 10): Exterior | null {
  const ring = m.corners;
  const n = ring.length;
  const clean = orthogonalRing(ring);
  if (!clean || clean.length !== n) return null;
  const made = exteriorFromOutline(ring, eaveFeet);
  if (!made) return null;
  const front = frontIndex(ring);
  if (front < 0) return null;
  const before = new Map((prev?.sides ?? []).map((s) => [s.id, s]));
  const keptIds = state.measured?.building === m.building ? state.measured.sideIds : undefined;
  const building = state.buildings.find((b) => b.id === m.building);
  const shared = building?.shared ? new Set(building.shared) : null;
  const sideIds: string[] = [];
  const sides: ExteriorSide[] = made.sides.map((s, k) => {
    const i = (front + k) % n;
    const A = ring[i] as Pt;
    const B = ring[(i + 1) % n] as Pt;
    const measured = m.sides[i];
    const id = keptIds?.[i] && before.has(keptIds[i] as string) ? (keptIds[i] as string) : s.id;
    sideIds[i] = id;
    const old = before.get(id);
    // A side measured again keeps what was put on it, stretched with its new length.
    const base: ExteriorSide = old ? stretched(old, s.lengthFeet) : { ...s, id };
    const { lengthFrom: _drawn, lengthPlusMinusPct: _pm, ...rest } = base;
    const side: ExteriorSide = { ...rest, id, name: old?.name ?? s.name, lengthFeet: s.lengthFeet, turn: s.turn, heightsFrom: "level" };
    if (measured && measured.plusMinusPct !== null) side.lengthPlusMinusPct = measured.plusMinusPct;
    // A party wall (2026-10-17): shared with the neighbour, so nothing on it counts, and no photo of it.
    // Said on the route it is the route's; a route from before says nothing, and the side keeps its own.
    const isShared = shared ? shared.has(i) : side.shared === true;
    if (isShared) side.shared = true;
    else delete side.shared;
    const photos = isShared ? [] : bestPhotos(m, state, ring, i);
    if (photos.length) side.photos = photos;
    else delete side.photos;
    return side;
  });
  const placed = m.cameras.length;
  const tapes = state.buildings.find((b) => b.id === m.building)?.tapes ?? [];
  const notes = [
    `Measured from ${placed} of ${state.photos.length} photo${state.photos.length === 1 ? "" : "s"} and ${tapes.length} tape${tapes.length === 1 ? "" : "s"}.`,
    ...(tapes.length === 0 ? ["No tape: the sizes follow the shape as drawn, and are not to scale."] : []),
  ];
  const { homeType: _was, ...prevRest } = prev ?? ({} as Partial<Exterior>);
  const homeType = building?.homeType ?? _was;
  return {
    ...prevRest,
    ...(homeType && homeType !== "detached" ? { homeType } : {}),
    sides,
    open: false,
    roof: prev?.roof ?? defaultRoof(),
    ...(prev?.scope ? { scope: { ...prev.scope, sides: prev.scope.sides.filter((x) => sides.some((s) => s.id === x)) } } : {}),
    photoRoute: { ...state, measured: { ...m, sideIds } },
    // "by photos": measured off ordinary photos and a few tapes, nothing tapped on the walls - the report words it so.
    source: { kind: "photos", by: "photos", captureId: null, scanId: null, receivedAt: m.at, notes, walkClosed: true },
  };
}

/** A side's length changed: its openings, faces and gable slide with it, in proportion. */
function stretched(side: ExteriorSide, lengthFeet: number): ExteriorSide {
  const r = side.lengthFeet > 0 ? lengthFeet / side.lengthFeet : 1;
  if (Math.abs(r - 1) < 1e-9) return side;
  const out: ExteriorSide = {
    ...side,
    lengthFeet,
    openings: side.openings.map((o) => ({ ...o, fromLeftFeet: o.fromLeftFeet * r })),
    gable: side.gable ? { ...side.gable, atFeet: side.gable.atFeet * r, ...(side.gable.fromFeet !== undefined ? { fromFeet: side.gable.fromFeet * r } : {}), ...(side.gable.toFeet !== undefined ? { toFeet: side.gable.toFeet * r } : {}) } : null,
  };
  if (side.shapes) out.shapes = side.shapes.map((s) => ({ ...s, polygon: s.polygon.map((p) => ({ x: p.x * r, y: p.y })) }));
  return out;
}

/** Whether the house hides the point P of side [side] from C: something of the outline crosses the line between them first. */
function hidden(ring: Pt[], side: number, C: Pt, P: Pt): boolean {
  const n = ring.length;
  for (let j = 0; j < n; j++) {
    if (j === side) continue;
    const a = ring[j] as Pt;
    const b = ring[(j + 1) % n] as Pt;
    const d1x = P.x - C.x;
    const d1y = P.y - C.y;
    const d2x = b.x - a.x;
    const d2y = b.y - a.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - C.x) * d2y - (a.y - C.y) * d2x) / den;
    const s = ((a.x - C.x) * d1y - (a.y - C.y) * d1x) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6) return true;
  }
  return false;
}

/** Up to two photos for a side: those that face it best and show the most of its bottom, with the house not in the way. */
function bestPhotos(m: RouteMeasured, state: PhotoRouteState, ring: Pt[], i: number): SidePhoto[] {
  const A = ring[i] as Pt;
  const B = ring[(i + 1) % ring.length] as Pt;
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const nrm = { x: (B.y - A.y) / L, y: -(B.x - A.x) / L };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const scored: { photo: SidePhoto; score: number }[] = [];
  for (const rc of m.cameras) {
    const lens = m.lenses[rc.photo];
    if (!lens) continue;
    const v = { x: rc.at[0] - mid.x, y: rc.at[1] - mid.y };
    const facing = (v.x * nrm.x + v.y * nrm.y) / (Math.hypot(v.x, v.y) || 1);
    if (facing < Math.sin((15 * Math.PI) / 180)) continue;
    // The side's middle, and a point a fifth in from each end: at least the middle and one more in clear view.
    const C = { x: rc.at[0], y: rc.at[1] };
    const at = (t: number) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
    if (hidden(ring, i, C, at(0.5)) || (hidden(ring, i, C, at(0.2)) && hidden(ring, i, C, at(0.8)))) continue;
    const index = state.photos.findIndex((p) => p.id === rc.photo);
    const sp = sidePhotoFor(lens, rc, A, B, 900 + Math.max(0, index), rc.photo);
    if (!sp?.inView) continue;
    const coverage = (sp.inView.toM - sp.inView.fromM) / (L * FOOT_M);
    scored.push({ photo: sp, score: facing * (0.3 + coverage) });
  }
  scored.sort((a, b) => b.score - a.score);
  const first = scored[0];
  if (!first) return [];
  // One photo, unless it misses an end of the wall that another shows: two blended disagree by an inch or two
  // at the seam (each camera's height is its own), and a seam across a window reads worse than a missing corner.
  const v = first.photo.inView;
  const second = scored.slice(1).find((s) => (!v?.leftEnd && s.photo.inView?.leftEnd) || (!v?.rightEnd && s.photo.inView?.rightEnd));
  return second ? [first.photo, second.photo] : [first.photo];
}

/** One line for the screen: "Measured from 12 of 18 photos and 4 tapes; the house is 70'3" by 51'2"." */
export function routeSummary(m: RouteMeasured, photos: number): string {
  const xs = m.corners.map((p) => p.x);
  const ys = m.corners.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  return `Measured from ${m.cameras.length} of ${photos} photos; the house is ${formatFeetInches(w)} across by ${formatFeetInches(d)} deep.`;
}

