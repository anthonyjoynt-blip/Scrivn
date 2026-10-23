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
 *     stays, stretched with its length;
 *   * each of the walk's close-ups laid on its wall's full photo (2026-10-23, `closeUpsOnSides`) is one
 *     more photo of that side, through the full photo's own, so it is read at the wall's scale. It
 *     sizes nothing.
 *
 * Pure: the editor and the tests make the same exterior from the same measure.
 */

import { defaultRoof, type Exterior, type ExteriorSide, type SidePhoto } from "./exterior";
import { photoOnPart } from "./exteriorPhoto";
import { exteriorFromOutline, orthogonalRing } from "./exteriorPlan";
import { type PhotoRouteInput, type PhotoRouteState, ROUTE_MATCH_V, type RouteCamera, type RouteMatch, type RouteMeasured, type RoutePhotoData, type RouteSolution, settleWords } from "./photoRoute";
import { shotWalls } from "./photoRouteCoverage";
import { MAP_LOOKUP_READY } from "./photoRouteMap";
import { detailSidePhoto, onWall } from "./photoRouteMatch";
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
    focalOverWidth: anyCam ? anyCam.f / Math.max(anyCam.width, anyCam.height) : 0,
    k: sol.solution.k,
    rms: sol.rms,
    corners: sol.corners.map((p) => ({ x: p.x, y: p.y })),
    sides: sol.sides.map(({ sdFeet: _sd, ...rest }) => rest),
    cameras: sol.cameras,
    unplaced: sol.unplaced,
    doubtful: sol.doubtful,
    advice: sol.advice,
    counts: sol.counts,
    lenses,
    ...(sol.tapeSpread ? { tapeSpread: sol.tapeSpread } : {}),
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
  const closeUps = closeUpsOnSides(state, m);
  const sized = new Set(m.cameras.filter((c) => c.role !== "detail").map((c) => c.photo));
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
    const { lengthFrom: _drawn, lengthPlusMinusPct: _pm, lengthEstimatedFeet: _est, lengthNotMeasured: _nm, lengthSettleSideId: _settle, ...rest } = base;
    const side: ExteriorSide = { ...rest, id, name: old?.name ?? s.name, lengthFeet: s.lengthFeet, turn: s.turn, heightsFrom: "level" };
    if (measured && measured.plusMinusPct !== null) side.lengthPlusMinusPct = measured.plusMinusPct;
    if (measured?.estimated && !measured.taped) side.lengthEstimatedFeet = measured.estimated.feet;
    if (measured?.notMeasured && !measured.taped) side.lengthNotMeasured = `${measured.notMeasured.why}. ${measured.notMeasured.fix}`;
    // A party wall (2026-10-17): shared with the neighbour, so nothing on it counts, and no photo of it.
    // Said on the route it is the route's; a route from before says nothing, and the side keeps its own.
    const isShared = shared ? shared.has(i) : side.shared === true;
    if (isShared) side.shared = true;
    else delete side.shared;
    const photos = isShared ? [] : withCloseUps(bestPhotos(m, state, ring, i), closeUps.laid.filter((c) => c.side === i), sized);
    if (photos.length) side.photos = photos;
    else delete side.photos;
    return side;
  });
  // Each side not measured says what settles it with its one wall by name (2026-10-23): "A tape or laser along the Walkway
  // side settles it". Asked, never required.
  const nameAt = (i: number) => wallWords(sides.find((q) => q.id === sideIds[i])?.name ?? "");
  for (const side of sides) {
    const i = sideIds.indexOf(side.id);
    const measured = m.sides[i];
    const nm = measured?.notMeasured;
    if (!nm || measured.taped) continue;
    side.lengthNotMeasured = `${nm.why}. ${settleWords(measured, nameAt, MAP_LOOKUP_READY && !building?.map)}`;
    if (nm.settle !== undefined && sideIds[nm.settle]) side.lengthSettleSideId = sideIds[nm.settle];
  }
  // Only the photos that sized it count as measured from (2026-10-22): a detail photo was placed afterwards, to be read.
  const placed = m.cameras.filter((c) => c.role !== "detail").length;
  const detail = m.cameras.length - placed;
  const tapes = state.buildings.find((b) => b.id === m.building)?.tapes ?? [];
  const estimated = m.sides.filter((s) => s.estimated && !s.taped).length;
  const notes = [
    `Measured from ${placed} of ${state.photos.length} photo${state.photos.length === 1 ? "" : "s"} and ${tapes.length} tape${tapes.length === 1 ? "" : "s"}${estimated ? `, with ${estimated} side${estimated === 1 ? "" : "s"} estimated on site by eye (not taped)` : ""}.`,
    ...(detail ? [`${detail} more photo${detail === 1 ? " was" : "s were"} placed on it only to read the walls; they sized nothing.`] : []),
    ...(closeUps.laid.length
      ? [`${closeUps.laid.length} close-up${closeUps.laid.length === 1 ? " was" : "s were"} laid exactly on ${closeUps.laid.length === 1 ? "its" : "their"} wall's photo, to read at the wall's scale; ${closeUps.laid.length === 1 ? "it" : "they"} sized nothing.`]
      : []),
    ...(m.sides.some((s) => s.notMeasured && !s.taped) ? [`Not measured: ${m.sides.filter((s) => s.notMeasured && !s.taped).length} of its sides - the photos and tapes don't hold them; each says what would measure it.`] : []),
    // How well the tapes agree, held out in turn (2026-10-23): a note on the house as a whole, never a blanket over its sides.
    ...(m.tapeSpread ? [m.tapeSpread.words] : []),
    ...(tapes.length === 0 ? [estimated ? "No tape: the sizes follow the sides estimated on site and the shape as drawn, and are not to scale." : "No tape: the sizes follow the shape as drawn, and are not to scale."] : []),
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

/**
 * What settles the sizes not measured, a sentence each, for the Use-it step and the measure's results (2026-10-23): the
 * sides one tape or laser settles together under it, that wall named - "Not measured: the Walkway side and the Left side.
 * A tape or laser along the Walkway side settles both." - and any other as its own says. Asked, never required: nothing
 * waits on it. Empty when everything is measured.
 */
export function notMeasuredAsks(exterior: Pick<Exterior, "sides" | "upper" | "photoRoute">): string[] {
  const all = [...exterior.sides, ...(exterior.upper?.sides ?? [])];
  const loose = all.filter((s) => s.lengthNotMeasured);
  if (!loose.length) return [];
  const the = (s: ExteriorSide) => wallWords(s.name);
  const list = (ss: ExteriorSide[]) => (ss.length === 1 ? the(ss[0] as ExteriorSide) : `${ss.slice(0, -1).map(the).join(", ")} and ${the(ss[ss.length - 1] as ExteriorSide)}`);
  const map = MAP_LOOKUP_READY && !(exterior.photoRoute?.buildings ?? []).some((b) => b.map) ? " Or tap your house on the map." : "";
  const groups = new Map<string, ExteriorSide[]>();
  const own: ExteriorSide[] = [];
  for (const s of loose) {
    const by = s.lengthSettleSideId && all.some((q) => q.id === s.lengthSettleSideId) ? s.lengthSettleSideId : null;
    if (by) groups.set(by, [...(groups.get(by) ?? []), s]);
    else own.push(s);
  }
  const out: string[] = [];
  for (const [by, ss] of groups) {
    const wall = all.find((q) => q.id === by) as ExteriorSide;
    const count = ss.length === 1 ? "it" : ss.length === 2 ? "both" : `all ${COUNT_WORDS[ss.length] ?? ss.length}`;
    out.push(
      ss.length === 1 && (ss[0] as ExteriorSide).id === by
        ? `${cap(the(wall))} isn't measured: a tape or laser along it settles it.${map}`
        : `Not measured: ${list(ss)}. A tape or laser along ${the(wall)} settles ${count}.${map}`,
    );
  }
  // Not a wall's tape (the tapes disagree): what it says, the tape to check.
  for (const s of own) {
    const said = s.lengthNotMeasured as string;
    const fix = said.split(". ").slice(1).join(". ") || said;
    out.push(`${cap(the(s))} isn't measured: ${fix.charAt(0).toLowerCase()}${fix.slice(1)}`);
  }
  return out;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const COUNT_WORDS: Record<number, string> = { 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };

const FACING_WORDS: Record<string, string> = { Front: "the front", Rear: "the back", Right: "the right side", Left: "the left side" };

/** A side's name as a wall in a sentence: "the Walkway side"; a plain facing as said - "the right side", "the back (2)". */
export function wallWords(name: string): string {
  const n = name.trim();
  const facing = /^(Front|Rear|Right|Left)(?: (\d+))?$/.exec(n);
  if (facing) return `${FACING_WORDS[facing[1] as string]}${facing[2] ? ` (${facing[2]})` : ""}`;
  if (!n) return "that side";
  return /^the /i.test(n) ? n : `the ${n}`;
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

// ── Close-ups laid on their walls (2026-10-23) ───────────────────────────────────────────────────

/** How finely a side is walked for what of it a photo sees. */
const VIEW_STEPS = 60;

/**
 * Placed photo [rc] laid on outline side [i] of measure [m]: what of the side it sees (in front of it, nothing of the house
 * in the way), and the photo as the side's (`sidePhotoFor`) - or, the side's middle out of the picture, laid on the part it
 * sees and shifted back to the side's own frame. Null when it sees none of it. As the house runner's reading pass does it
 * (scripts/house/read.mjs photoOnSide).
 */
export function sideView(m: RouteMeasured, rc: RouteCamera, i: number, n: number): { sp: SidePhoto; vis: boolean[]; lengthFeet: number } | null {
  const ring = m.corners;
  const A = ring[i] as Pt;
  const B = ring[(i + 1) % ring.length] as Pt;
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const lens = m.lenses[rc.photo];
  if (!(L > 0.1) || !lens) return null;
  const nrm = { x: (B.y - A.y) / L, y: -(B.x - A.x) / L };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const v = { x: rc.at[0] - mid.x, y: rc.at[1] - mid.y };
  if ((v.x * nrm.x + v.y * nrm.y) / (Math.hypot(v.x, v.y) || 1) <= 0.02) return null;
  const C = { x: rc.at[0], y: rc.at[1] };
  const vis: boolean[] = [];
  for (let k = 0; k <= VIEW_STEPS; k++) {
    const t = k / VIEW_STEPS;
    const P = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    vis.push((C.x - P.x) * nrm.x + (C.y - P.y) * nrm.y > 0 && !hidden(ring, i, C, P));
  }
  const ks = vis.map((b, k) => (b ? k : -1)).filter((k) => k >= 0);
  if (ks.length === 0) return null;
  let sp = sidePhotoFor(lens, rc, A, B, n, rc.photo);
  if (!sp) {
    const t0 = (ks[0] as number) / VIEW_STEPS;
    const t1 = (ks[ks.length - 1] as number) / VIEW_STEPS;
    const A2 = { x: A.x + (B.x - A.x) * t0, y: A.y + (B.y - A.y) * t0 };
    const B2 = { x: A.x + (B.x - A.x) * t1, y: A.y + (B.y - A.y) * t1 };
    const sp2 = t1 > t0 ? sidePhotoFor(lens, rc, A2, B2, n, rc.photo) : null;
    if (sp2) sp = photoOnPart(sp2, -t0 * L, 0, L, (t1 - t0) * L);
  }
  return sp ? { sp, vis, lengthFeet: L } : null;
}

/**
 * How many of [points] (a photo's pixels as taken) lie on the face of the side [view] lays it on: along it to 3' past its
 * ends, from 2' under its ground to 40' up, on a stretch the photo sees. Loosely: the measured ends and heights are rough,
 * and a trim or a rail's end past a corner is fine; points cast on past a deck's rail onto the wall behind land far along.
 */
function onFaceCount(view: { sp: SidePhoto; vis: boolean[]; lengthFeet: number }, points: readonly [number, number][]): number {
  const L = view.lengthFeet;
  let count = 0;
  for (const [px, py] of points) {
    const w = onWall(view.sp, px, py);
    if (!w) continue;
    const a = w[0] / FOOT_M;
    const u = w[1] / FOOT_M;
    const k = Math.max(0, Math.min(view.vis.length - 1, Math.round((a / L) * (view.vis.length - 1))));
    if (a >= -3 && a <= L + 3 && u >= -2 && u <= 40 && view.vis[k]) count++;
  }
  return count;
}

/**
 * On its side's face, at least this share of a close-up's points that agree: else it was laid on something in front of the
 * wall or another wall. On the owner's house (10-23) close-ups laid right had 41-56% on the face, the one laid on a deck's
 * glass rail 16% (scripts/house/match.mjs ON_FACE_SHARE).
 */
export const ON_FACE_SHARE = 0.3;

/** A close-up laid on its side: outline side [side], and the close-up as a photo of it. */
export interface LaidCloseUp {
  photo: string;
  full: string;
  side: number;
  sp: SidePhoto;
  by: RouteMatch["by"];
}

/**
 * A close-up not laid on its side, and why: no place for it found in code (or its taps hold no wall) - "unfound"; its wall's
 * photo not placed by the measure - "unplaced"; laid on something that isn't the wall's face - "offFace".
 */
export interface CloseUpNotLaid {
  photo: string;
  full: string;
  kind: "unfound" | "unplaced" | "offFace";
  why: string;
}

/**
 * The walk's close-ups on their sides, from the matches the measure keeps (`RouteMeasured.matches`, 2026-10-23): each laid on
 * the wall its matched points are on - of the walls its full photo was taken of, when the walk says (`RoutePhoto.shot`),
 * else any - and kept only with ON_FACE_SHARE of them on that wall's face as measured. Laid, it is a photo of that side
 * through the full photo's own `to_photo` (`detailSidePhoto`), so whatever it shows is at the wall's scale. It never sizes
 * anything. The rest, each with why not, in words.
 */
export function closeUpsOnSides(state: PhotoRouteInput, m: RouteMeasured): { laid: LaidCloseUp[]; not: CloseUpNotLaid[] } {
  const laid: LaidCloseUp[] = [];
  const not: CloseUpNotLaid[] = [];
  const n = m.corners.length;
  if (n < 3) return { laid, not };
  const shared = new Set(state.buildings.find((b) => b.id === m.building)?.shared ?? []);
  const nameOf = (id: string) => `photo ${state.photos.findIndex((p) => p.id === id) + 1}`;
  // Taps first: what the user laid stands over what code found.
  const matches = (m.matches ?? []).filter((x) => x.v === ROUTE_MATCH_V).sort((a, b) => (a.by === b.by ? 0 : a.by === "taps" ? -1 : 1));
  for (const x of matches) {
    if (laid.some((l) => l.photo === x.photo) || not.some((q) => q.photo === x.photo)) continue;
    const detail = state.photos.find((p) => p.id === x.photo);
    const fullAt = state.photos.findIndex((p) => p.id === x.full);
    if (!detail || fullAt < 0) continue;
    if (!x.h) {
      not.push({ photo: x.photo, full: x.full, kind: "unfound", why: x.words });
      continue;
    }
    const rc = m.cameras.find((c) => c.photo === x.full);
    if (!rc) {
      not.push({ photo: x.photo, full: x.full, kind: "unplaced", why: `Its wall's photo (${nameOf(x.full)}) wasn't placed by the measure, so there is no wall to lay it on yet.` });
      continue;
    }
    // Of the walls the walk says its full photo was taken of (a "more of this wall" photo is of that wall): never another
    // the points seem to be on - a corner the measure has loose put the porch's close-up on the AC side (house runner,
    // 10-23). With nothing said, whichever holds the most of them.
    const shot = state.photos[fullAt]?.shot;
    const said = new Set(shot ? shotWalls(shot, n).filter((i) => i >= 0 && i < n) : []);
    let best: { i: number; count: number; view: NonNullable<ReturnType<typeof sideView>> } | null = null;
    for (let i = 0; i < n; i++) {
      if (shared.has(i) || (said.size && !said.has(i))) continue;
      const view = sideView(m, rc, i, 900 + fullAt);
      if (!view) continue;
      const count = onFaceCount(view, x.onFull);
      if (count > 0 && (!best || count > best.count)) best = { i, count, view };
    }
    if (!best) {
      not.push({ photo: x.photo, full: x.full, kind: "offFace", why: `Its points aren't on ${said.size === 1 ? "the wall it was taken for" : "a wall the measure has"}: tap 4 points on both, on the wall's face.` });
      continue;
    }
    const share = best.count / Math.max(1, x.onFull.length);
    if (share < ON_FACE_SHARE) {
      not.push({
        photo: x.photo,
        full: x.full,
        kind: "offFace",
        why: `It matched something in front of the wall - a rail, a post - not the wall itself (${Math.round(share * 100)}% of its points are on it): tap 4 points on both, on the wall's face.`,
      });
      continue;
    }
    const lens = m.lenses[x.photo];
    const sp = detailSidePhoto(
      best.view.sp,
      { h: x.h },
      { width: detail.width, height: detail.height, f: lens?.f ?? m.focalOverWidth * Math.max(detail.width, detail.height), k: lens?.k ?? m.k },
      900 + state.photos.indexOf(detail),
      x.photo,
      best.view.lengthFeet * FOOT_M,
    );
    if (!sp) {
      not.push({ photo: x.photo, full: x.full, kind: "offFace", why: "Laid on its wall's photo, but the wall is behind it there: tap 4 points on both, on the wall's face." });
      continue;
    }
    laid.push({ photo: x.photo, full: x.full, side: best.i, sp, by: x.by });
  }
  return { laid, not };
}

/**
 * A side's photos with the close-ups laid on it: each in place of the same photo placed where it was guessed to stand. One
 * that sized the house itself (two corners or more on it) stays where the measure put it, if it is there already.
 */
function withCloseUps(photos: SidePhoto[], here: LaidCloseUp[], sized: Set<string>): SidePhoto[] {
  const add = here.filter((c) => !(sized.has(c.photo) && photos.some((p) => p.claimPhotoId === c.photo)));
  if (add.length === 0) return photos;
  return [...photos.filter((p) => !add.some((c) => c.photo === p.claimPhotoId)), ...add.map((c) => c.sp)];
}

/** One line for the screen: "Measured from 12 of 18 photos and 4 tapes; the house is 70'3" by 51'2"." */
export function routeSummary(m: RouteMeasured, photos: number): string {
  const xs = m.corners.map((p) => p.x);
  const ys = m.corners.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  return `Measured from ${m.cameras.length} of ${photos} photos; the house is ${formatFeetInches(w)} across by ${formatFeetInches(d)} deep.`;
}

