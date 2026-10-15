/**
 * Roof pieces (2026-10-15): what the drawing can't make, put on top of it - dormers, turrets, a
 * curved or flat roof - so one dormer no longer means typing the whole roof by hand.
 *
 * ── How they count ─────────────────────────────────────────────────────────────────────────────
 * A piece's quantities ADD to the drawing's (lib/exterior.ts `roofingQuantities`), each worked out
 * here in closed form from the few numbers an estimator tapes or reads off a photo. A total typed
 * by the estimator (`ExteriorRoof.typed`) still replaces the drawing's AND the pieces' alike: a roof
 * report already counts its dormers, so adding them again would count them twice.
 *
 * ── Where a piece came from (2026-10-15) ───────────────────────────────────────────────────────
 * The owner's route for a roof is the side photos (docs/roof-from-photos.md), so a piece is a slot
 * the photos can fill: typed by the estimator (`source` absent or "typed"), or proposed off the
 * photos ("photos") for the estimator to tick (`taken`). A proposal counts nothing until ticked -
 * never applied by itself, as a roof report's totals are not - and once ticked its lines say "(from
 * photos)". A number of it changed by hand makes it the estimator's (`editedPiece`). The side photos'
 * dormers and turrets fill it since 2026-10-15 (lib/roofPhotoShapes.ts, lib/exterior.ts `photoRoofPieces`):
 * kept on their sides and worked out on the roof as built, they come here as pieces "from photos".
 *
 * ── The pieces ─────────────────────────────────────────────────────────────────────────────────
 * Lengths in feet, pitches rise in 12; m is the slope a dormer sits on (the roof's unless said).
 * Measured to the walls: an overhang is not added, so take it in if it is wanted.
 *   * GABLE DORMER, width W, projection D (its face back to where its eaves meet the slope, in
 *     plan) and its own pitch d. Its eaves stand mD over the slope at the face; its ridge runs on
 *     dW/2m past them, so in plan it covers DW + dW²/4m - the same plan as the hole it makes, so
 *     its area is that plan at its own pitch LESS that plan at the slope's. Its two valleys are a
 *     cross gable's at a different pitch (lib/roof.ts): each (W/2)·√(1 + (d/m)² + d²). Step
 *     flashing up both cheeks, D·√(1 + m²) each; apron flashing W across the face (counted with
 *     the headwall flashing); two eaves D long and two rakes (W/2)·√(1 + d²). Cheeks mD²/2 each
 *     and the face W·mD + dW²/4 of siding, gross.
 *   * SHED DORMER, width W, projection D (its face back to where its roof meets the slope) and its
 *     pitch s, flatter than the slope's. Its area is WD at s less WD at m. Headwall flashing W
 *     where its roof meets the slope, apron W across the face, step D·√(1 + m²) up each cheek; one
 *     eave W and two rakes D·√(1 + s²). Cheeks (m − s)D²/2 each and the face W·D(m − s).
 *   * ROUND TURRET, diameter, pitch: a cone, π·r·(slant height), its eave the circle.
 *   * POLYGON TURRET, n sides of a: a pyramid, n triangles of base a up the slant height over the
 *     inradius a/2·tan(π/n); n hips from the corners (circumradius a/2·sin(π/n)) to the top.
 *   * CURVED (BARREL), span S, length L, rise h: a circular arc, radius (S²/4 + h²)/2h over a
 *     half-angle 2·atan(2h/S); its area the arc times L, two eaves L and the two arcs as rakes.
 *   * FLAT, its SF at 0/12, its perimeter an eave or a drip edge alone.
 *   * OTHER, its SF (at its pitch, or the roof's) and any lengths, as typed.
 * A count puts several alike on at once.
 */

export type RoofPieceKind = "gableDormer" | "shedDormer" | "roundTurret" | "polygonTurret" | "barrel" | "flat" | "other";

export const ROOF_PIECE_KINDS: RoofPieceKind[] = ["gableDormer", "shedDormer", "roundTurret", "polygonTurret", "barrel", "flat", "other"];

export const ROOF_PIECE_LABEL: Record<RoofPieceKind, string> = {
  gableDormer: "Gable dormer",
  shedDormer: "Shed dormer",
  roundTurret: "Round turret",
  polygonTurret: "Many-sided turret",
  barrel: "Curved (barrel) roof",
  flat: "Flat roof",
  other: "Other",
};

/** The lengths a piece adds to, as the roof's totals are named. */
export type PieceLengthKey = "ridge" | "hip" | "valley" | "eave" | "rake" | "step" | "headwall";
export const PIECE_LENGTH_KEYS: PieceLengthKey[] = ["ridge", "hip", "valley", "eave", "rake", "step", "headwall"];

/** A piece of roof the drawing can't make, put on top of it. Only the fields of its kind are read. */
export interface RoofPiece {
  id: string;
  kind: RoofPieceKind;
  /** An Other piece: what it is ("bay roof"). */
  label?: string;
  /** Typed by the estimator (absent), or proposed off the side photos for the estimator to tick. */
  source?: "typed" | "photos";
  /** A proposal off the photos ticked by the estimator: only then does it count. */
  taken?: boolean;
  /** How many alike: two dormers the same size. Absent: one. */
  count?: number;
  /** A dormer: across its face. */
  widthFeet?: number | null;
  /** A dormer: from its face back to where it meets the slope, in plan. */
  projectionFeet?: number | null;
  /** Its own pitch: a dormer's or a turret's; an Other piece's, else the roof's. */
  pitch?: number | null;
  /** A dormer: the pitch of the slope it is on; blank, the roof's. */
  onPitch?: number | null;
  /** A round turret. */
  diameterFeet?: number | null;
  /** A many-sided turret: how many sides, and each one's length. */
  sideCount?: number | null;
  sideFeet?: number | null;
  /** A curved roof: across its springing, along it, and how high the arc stands over its span. */
  spanFeet?: number | null;
  lengthFeet?: number | null;
  riseFeet?: number | null;
  /** A flat or Other piece: its area on the slope. */
  squareFeet?: number | null;
  /** A flat piece: its edge, an eave (with starter and ice & water) or a drip edge alone. */
  perimeterFeet?: number | null;
  perimeterAs?: "eave" | "dripEdge";
  /** An Other piece: its lengths, as typed. */
  lengths?: Partial<Record<PieceLengthKey, number | null>>;
}

/** What one piece adds, its count taken in. */
export interface PieceFigures {
  /** What still has to be typed before it counts: empty when it does. */
  missing: string[];
  /** On the slope, by pitch: its own roof, and less the slope a dormer covers. Pitch null: curved. */
  areas: { pitch: number | null; squareFeet: number }[];
  /** Their sum: what it adds to the roof's area (less than nothing for a dormer flatter than its slope). */
  squareFeet: number;
  lengths: Record<PieceLengthKey, number>;
  /** A drip edge of its own, apart from its eaves and rakes: a flat roof's edge said to be one. */
  dripEdgeFeet: number;
  /** A dormer's apron across its face: in `lengths.headwall`, said apart on the piece. */
  apronFeet: number;
  /** A dormer's cheeks and face, gross: nothing taken off for its window. */
  sidingSquareFeet: number;
}

const given = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const givenOrZero = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const factor = (k: number) => Math.sqrt(1 + k * k);

function zero(): PieceFigures {
  return { missing: [], areas: [], squareFeet: 0, lengths: { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, step: 0, headwall: 0 }, dripEdgeFeet: 0, apronFeet: 0, sidingSquareFeet: 0 };
}

/** Whether a piece counts: typed, or proposed off the photos and ticked. */
export function pieceCounts(piece: RoofPiece): boolean {
  return piece.source !== "photos" || piece.taken === true;
}

/** Off the photos, as the lines say it. */
export function pieceFromPhotos(piece: RoofPiece): boolean {
  return piece.source === "photos";
}

/** A piece with a number changed by hand: the estimator's from then on, whatever proposed it. */
export function editedPiece(piece: RoofPiece, change: Partial<RoofPiece>): RoofPiece {
  const out: RoofPiece = { ...piece, ...change };
  delete out.source;
  delete out.taken;
  return out;
}

/** How many alike: a whole number, at least one. */
export function pieceCount(piece: RoofPiece): number {
  const n = Math.round(piece.count ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** One piece's quantities, its count taken in: worked in closed form (see the head of this file). `roofPitch` is the roof's main pitch. */
export function pieceFigures(piece: RoofPiece, roofPitch: number): PieceFigures {
  const out = zero();
  const L = out.lengths;
  const need = (what: string) => out.missing.push(what);
  switch (piece.kind) {
    case "gableDormer":
    case "shedDormer": {
      const W = given(piece.widthFeet);
      const D = given(piece.projectionFeet);
      const p = piece.kind === "gableDormer" ? given(piece.pitch) : givenOrZero(piece.pitch);
      const mPitch = givenOrZero(piece.onPitch) ?? roofPitch;
      if (W === null) need("its width");
      if (D === null) need("its projection");
      if (p === null) need("its pitch");
      if (!(mPitch > 0)) need("the pitch of the slope it is on");
      if (W === null || D === null || p === null || !(mPitch > 0)) break;
      const m = mPitch / 12;
      const k = p / 12;
      if (piece.kind === "gableDormer") {
        const plan = D * W + (k * W * W) / (4 * m);
        out.areas.push({ pitch: p, squareFeet: plan * factor(k) }, { pitch: mPitch, squareFeet: -plan * factor(m) });
        L.ridge = D + (k * W) / (2 * m);
        L.valley = W * Math.sqrt(1 + (k / m) ** 2 + k * k);
        L.eave = 2 * D;
        L.rake = W * factor(k);
        L.step = 2 * D * factor(m);
        out.apronFeet = W;
        out.sidingSquareFeet = m * D * D + W * m * D + (k * W * W) / 4;
      } else {
        if (!(k < m)) {
          need("a pitch flatter than the slope it is on");
          break;
        }
        out.areas.push({ pitch: p, squareFeet: W * D * factor(k) }, { pitch: mPitch, squareFeet: -W * D * factor(m) });
        // Its roof meets the slope along its top: flashed there as a headwall, besides the apron across its face.
        L.eave = W;
        L.rake = 2 * D * factor(k);
        L.step = 2 * D * factor(m);
        out.apronFeet = W;
        L.headwall = W;
        out.sidingSquareFeet = (m - k) * D * D + W * D * (m - k);
      }
      L.headwall += out.apronFeet;
      break;
    }
    case "roundTurret": {
      const Dm = given(piece.diameterFeet);
      const p = given(piece.pitch);
      if (Dm === null) need("its diameter");
      if (p === null) need("its pitch");
      if (Dm === null || p === null) break;
      const r = Dm / 2;
      out.areas.push({ pitch: p, squareFeet: Math.PI * r * r * factor(p / 12) });
      L.eave = Math.PI * Dm;
      break;
    }
    case "polygonTurret": {
      const n = given(piece.sideCount) === null ? null : Math.round(piece.sideCount as number);
      const a = given(piece.sideFeet);
      const p = given(piece.pitch);
      if (n === null || n < 3) need("how many sides (3 or more)");
      if (a === null) need("each side's length");
      if (p === null) need("its pitch");
      if (n === null || n < 3 || a === null || p === null) break;
      const k = p / 12;
      const inradius = a / (2 * Math.tan(Math.PI / n));
      const circumradius = a / (2 * Math.sin(Math.PI / n));
      out.areas.push({ pitch: p, squareFeet: (n * a * inradius * factor(k)) / 2 });
      L.hip = n * Math.hypot(circumradius, inradius * k);
      L.eave = n * a;
      break;
    }
    case "barrel": {
      const S = given(piece.spanFeet);
      const len = given(piece.lengthFeet);
      const h = given(piece.riseFeet);
      if (S === null) need("its span");
      if (len === null) need("its length");
      if (h === null) need("its rise");
      if (S === null || len === null || h === null) break;
      const radius = (S * S) / 4 / (2 * h) + h / 2;
      const arc = 2 * radius * 2 * Math.atan((2 * h) / S);
      out.areas.push({ pitch: null, squareFeet: arc * len });
      L.eave = 2 * len;
      L.rake = 2 * arc;
      break;
    }
    case "flat": {
      const sf = given(piece.squareFeet);
      if (sf === null) need("its area");
      if (sf === null) break;
      out.areas.push({ pitch: 0, squareFeet: sf });
      const edge = given(piece.perimeterFeet) ?? 0;
      if (piece.perimeterAs === "dripEdge") out.dripEdgeFeet = edge;
      else L.eave = edge;
      break;
    }
    case "other": {
      const sf = given(piece.squareFeet);
      const lengths = piece.lengths ?? {};
      if (sf !== null) out.areas.push({ pitch: givenOrZero(piece.pitch) ?? roofPitch, squareFeet: sf });
      for (const key of Object.keys(lengths) as PieceLengthKey[]) {
        if (PIECE_LENGTH_KEYS.includes(key)) L[key] = given(lengths[key]) ?? 0;
      }
      if (sf === null && PIECE_LENGTH_KEYS.every((key) => L[key] === 0)) need("its area or a length");
      break;
    }
  }
  if (out.missing.length > 0) return { ...zero(), missing: out.missing };
  // Several alike: every figure that many times.
  const n = pieceCount(piece);
  for (const key of PIECE_LENGTH_KEYS) L[key] *= n;
  out.areas = out.areas.map((a) => ({ ...a, squareFeet: a.squareFeet * n }));
  out.squareFeet = out.areas.reduce((s, a) => s + a.squareFeet, 0);
  out.dripEdgeFeet *= n;
  out.apronFeet *= n;
  out.sidingSquareFeet *= n;
  return out;
}
