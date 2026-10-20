import type { DeckPartKind, DeckPlanShape, RailingKind } from "@/lib/decks";
import { clipRect, type Footprint } from "@/lib/exterior";
import type { Pt } from "@/lib/roof";
import { formatFeetInches } from "@/lib/sketch";

/**
 * Decks drawn (2026-10-20, lib/decks.ts): on an elevation, each upright piece as it looks - glass panels you see the wall
 * through, aluminum pickets, the treads' risers, posts, the rim, a privacy screen's boards - and on a plan, its outline,
 * boards, railings by kind, stairs and posts. Styled by attributes, as every exterior drawing is: drawn on its own as an
 * image, an SVG has no stylesheet.
 */

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const INK = "#1a1d23";
const LINE = "#374151";
/** Decking and the treads' risers, by what they are: the owner's composite is a mid brown. */
export const DECKING_FILL: Record<string, string> = { composite: "#7c6857", wood: "#b9935f", membrane: "#8d939a", other: "#9a8f80" };
const WHITE = "#ffffff";
const GLASS = "#cfe3ef";
const STRINGER = "#c9a678";
const SCREEN_FILL: Record<string, string> = { wood: "#b5824f", vinyl: "#f4f4f1", lattice: "#e9dcc4", composite: "#7c6857", aluminum: "#c9ced4", other: "#d8d2c6" };
const POST_FILL: Record<string, string> = { wood: "#c9a678", concrete: "#c7c7c2", steel: "#9aa1a9", aluminum: WHITE, other: WHITE };

/** A railing on a plan, by kind: glass blue, pickets dark and dashed, wood brown, cable fine. */
export const RAIL_PLAN: Record<RailingKind, { stroke: string; width: number; dash?: string }> = {
  glass: { stroke: "#2f7fb5", width: 2.4 },
  aluminum: { stroke: "#1f2937", width: 2.2, dash: "2 1.5" },
  wood: { stroke: "#8a5a2b", width: 2.4 },
  cable: { stroke: "#4b5563", width: 1.4, dash: "5 2" },
  other: { stroke: "#4b5563", width: 2 },
};

const stroke = { vectorEffect: "non-scaling-stroke" as const };
const Y = (z: number) => -z;
const pts = (poly: Pt[]) => poly.map((p) => `${p.x},${Y(p.y)}`).join(" ");

/** A piece of a deck on an elevation: in the drawing's frame, feet along and up. */
export interface DeckPieceDrawn {
  kind: DeckPartKind;
  poly: Pt[];
  facing: number;
  material?: string;
  /** Its deck's ground at its outer edge, in the drawing's frame. */
  ground?: number;
}

/** Each infill line's two ends along a quad's bottom (a→b) and top (d→c) edges, [step] feet apart across. */
function across(poly: Pt[], step: number, most = 160): [Pt, Pt][] {
  if (poly.length < 4) return [];
  const [a, b, c, d] = poly as [Pt, Pt, Pt, Pt];
  const span = Math.abs(b.x - a.x);
  if (span < 1e-6) return [];
  const n = Math.min(most, Math.max(1, Math.floor(span / step)));
  const out: [Pt, Pt][] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    out.push([
      { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      { x: d.x + (c.x - d.x) * t, y: d.y + (c.y - d.y) * t },
    ]);
  }
  return out;
}

/** Level lines across an upright quad, [step] feet apart up it: a screen's boards, a cable rail's cables. */
function levels(poly: Pt[], step: number): [Pt, Pt][] {
  if (poly.length < 4) return [];
  const [a, b, c, d] = poly as [Pt, Pt, Pt, Pt];
  const h = Math.max(Math.abs(d.y - a.y), Math.abs(c.y - b.y));
  if (h < 1e-6) return [];
  const n = Math.min(60, Math.max(1, Math.floor(h / step)));
  const out: [Pt, Pt][] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    out.push([
      { x: a.x + (d.x - a.x) * t, y: a.y + (d.y - a.y) * t },
      { x: b.x + (c.x - b.x) * t, y: b.y + (c.y - b.y) * t },
    ]);
  }
  return out;
}

const Line = ({ a, b, ink, width, opacity }: { a: Pt; b: Pt; ink: string; width: number; opacity?: number }) => (
  <line x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke={ink} strokeWidth={width} strokeOpacity={opacity} {...stroke} />
);

/** One upright piece of a deck, as it looks. */
export function DeckPiece({ piece, fs }: { piece: DeckPieceDrawn; fs: number }) {
  const p = piece.poly;
  switch (piece.kind) {
    case "glass":
      // The wall shows through; a glint says it is glass.
      return (
        <g>
          <polygon points={pts(p)} fill={GLASS} fillOpacity={0.4} stroke="#7d9bb0" strokeWidth={0.6} {...stroke} />
          {p.length >= 4 && (
            <Line
              a={{ x: (p[0] as Pt).x * 0.8 + (p[1] as Pt).x * 0.2, y: (p[0] as Pt).y * 0.3 + (p[3] as Pt).y * 0.7 }}
              b={{ x: (p[0] as Pt).x * 0.65 + (p[1] as Pt).x * 0.35, y: (p[0] as Pt).y * 0.7 + (p[3] as Pt).y * 0.3 }}
              ink="#9fbccf"
              width={0.8}
            />
          )}
        </g>
      );
    case "pickets": {
      // White aluminum pickets every 4½", a bottom rail under them: each white with a dark edge, so it shows on a light wall and a dark one.
      const lines = across(p, 4.5 / 12);
      return (
        <g>
          {p.length >= 4 && <Line a={p[0] as Pt} b={p[1] as Pt} ink={LINE} width={2.6} />}
          {p.length >= 4 && <Line a={p[0] as Pt} b={p[1] as Pt} ink={WHITE} width={1.4} />}
          {lines.map(([a, b], i) => (
            <Line key={`e${i}`} a={a} b={b} ink={LINE} width={2.2} />
          ))}
          {lines.map(([a, b], i) => (
            <Line key={`w${i}`} a={a} b={b} ink={WHITE} width={1.1} />
          ))}
        </g>
      );
    }
    case "cable":
      return (
        <g>
          {levels(p, 3 / 12).map(([a, b], i) => (
            <Line key={i} a={a} b={b} ink="#6b7280" width={0.5} />
          ))}
        </g>
      );
    case "rail":
    case "railPost":
      return <polygon points={pts(p)} fill={WHITE} stroke={LINE} strokeWidth={0.7} strokeLinejoin="round" {...stroke} />;
    case "post":
      return <polygon points={pts(p)} fill={POST_FILL[piece.material ?? "aluminum"] ?? WHITE} stroke={LINE} strokeWidth={0.8} {...stroke} />;
    case "rim":
      return <polygon points={pts(p)} fill="#f7f7f5" stroke={LINE} strokeWidth={0.9} strokeLinejoin="round" {...stroke} />;
    case "riser":
      return <polygon points={pts(p)} fill={DECKING_FILL[piece.material ?? "composite"] ?? DECKING_FILL.composite} stroke="#3f342b" strokeWidth={0.6} {...stroke} />;
    case "stringer":
      return <polygon points={pts(p)} fill={STRINGER} stroke="#6b5233" strokeWidth={0.7} strokeLinejoin="round" {...stroke} />;
    case "screen":
    case "skirting": {
      const fill = SCREEN_FILL[piece.material ?? "wood"] ?? SCREEN_FILL.other;
      const lattice = piece.material === "lattice";
      return (
        <g>
          <polygon points={pts(p)} fill={fill} stroke="#5b4630" strokeWidth={0.8} {...stroke} />
          {(lattice ? [] : levels(p, 0.5)).map(([a, b], i) => (
            <Line key={i} a={a} b={b} ink="#6e4d2c" width={0.5} opacity={0.8} />
          ))}
          {lattice && across(p, 0.5).map(([a, b], i) => <Line key={i} a={a} b={b} ink="#8a6a45" width={0.5} />)}
        </g>
      );
    }
    default:
      // A level piece - the decking, a tread, a landing - is edge-on in an elevation.
      void fs;
      return null;
  }
}

/** Every piece of the decks in front of a drawing, back to front as given. */
export function DeckPieces({ pieces, fs }: { pieces: DeckPieceDrawn[]; fs: number }) {
  return (
    <g pointerEvents="none">
      {pieces.map((piece, i) => (
        <DeckPiece key={i} piece={piece} fs={fs} />
      ))}
    </g>
  );
}

/** Where the decks stand in a drawing, and their ground: the one their pieces carry, else their lowest piece's foot. */
function deckSpan(pieces: DeckPieceDrawn[]): { x0: number; x1: number; y: number } | null {
  if (pieces.length === 0) return null;
  const xs = pieces.flatMap((p) => p.poly.map((q) => q.x));
  const said = pieces.map((p) => p.ground).filter((g): g is number => g !== undefined);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y: said.length > 0 ? Math.min(...said) : Math.min(...pieces.flatMap((p) => p.poly.map((q) => q.y))) };
}

/**
 * The ground a deck stands on, where it is higher than the wall's own (a lawn up from the low ground at a walk-out's walls):
 * the line its stairs land on and its outer posts stand on, drawn in front. Null where it isn't higher.
 */
export function deckGroundAbove(ground: Pt[], pieces: DeckPieceDrawn[]): { x0: number; x1: number; y: number } | null {
  const s = deckSpan(pieces);
  if (!s || ground.length < 2) return null;
  const at = (x: number) => {
    const g = [...ground].sort((a, b) => a.x - b.x);
    let best = (g[0] as Pt).y;
    for (const p of g) if (p.x <= x) best = p.y;
    return best;
  };
  return s.y > Math.max(at(s.x0), at(s.x1)) + 0.25 ? s : null;
}

/** The ground under a deck that stands lower than the wall's own ground (a porch whose wall was measured from it): the line stepped down under it. */
export function groundUnderDecks(ground: Pt[], pieces: DeckPieceDrawn[]): Pt[] {
  if (pieces.length === 0 || ground.length < 2) return ground;
  const span = deckSpan(pieces) as { x0: number; x1: number; y: number };
  const x0 = span.x0;
  const x1 = span.x1;
  const low = span.y;
  const yAt = (x: number) => {
    const s = [...ground].sort((a, b) => a.x - b.x);
    if (x <= (s[0] as Pt).x) return (s[0] as Pt).y;
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i] as Pt;
      const b = s[i + 1] as Pt;
      if (x >= a.x && x <= b.x) return b.x - a.x > 1e-9 ? a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) : Math.min(a.y, b.y);
    }
    return (s[s.length - 1] as Pt).y;
  };
  if (!(low < Math.min(yAt(x0), yAt(x1)) - 0.25)) return ground;
  const e = 1e-4;
  const keys = [...new Set([...ground.map((p) => p.x), x0 - e, x0 + e, x1 - e, x1 + e])].sort((a, b) => a - b);
  return keys.map((x) => ({ x, y: x > x0 && x < x1 ? Math.min(yAt(x), low) : yAt(x) }));
}

// ---------------------------------------------------------------------------------------------
// On a plan
// ---------------------------------------------------------------------------------------------

/** A deck on a plan: a warm wood, apart from the house's paler fill. */
export const DECK_PLAN_FILL = "#e6d2b0";

function insidePoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Where a deck's name goes: from the middle of its longest edge, halfway across the deck - the widest strip of an L, not its corner. */
export function labelSpot(poly: Pt[], fs: number): Pt {
  let best: { len: number; at: Pt } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (best && len <= best.len) continue;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const n = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
    for (const s of [1, -1]) {
      const d = { x: n.x * s, y: n.y * s };
      if (!insidePoly(poly, { x: m.x + d.x * 0.05, y: m.y + d.y * 0.05 })) continue;
      // Across the deck from there: to the first edge the line meets.
      let far = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k] as Pt;
        const b = poly[(k + 1) % poly.length] as Pt;
        const e = { x: b.x - a.x, y: b.y - a.y };
        const den = d.x * e.y - d.y * e.x;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((a.x - m.x) * e.y - (a.y - m.y) * e.x) / den;
        const u = ((a.x - m.x) * d.y - (a.y - m.y) * d.x) / den;
        if (t > 0.05 && u >= -1e-9 && u <= 1 + 1e-9) far = Math.min(far, t);
      }
      const step = Number.isFinite(far) ? far / 2 : fs;
      best = { len, at: { x: m.x + d.x * step, y: m.y + d.y * step } };
    }
  }
  return best?.at ?? (poly[0] as Pt);
}

/** The decks' names alone, to go over the house drawn after them. */
export function DeckPlanNames({ shapes, fs }: { shapes: DeckPlanShape[]; fs: number }) {
  return (
    <g pointerEvents="none">
      {shapes.map((d) => {
        const c = labelSpot(d.plan, fs);
        return (
          <text key={d.id} x={c.x} y={Y(c.y) + fs * 0.32} fontSize={fs * 0.85} textAnchor="middle" fill="#5b4630" fontFamily={FONT} fontStyle="italic">
            {d.name}
          </text>
        );
      })}
    </g>
  );
}

/** Where an edge's length goes: its middle, or the middle of its longest stretch clear of a stair coming off it. */
function clearOfStairs(e: DeckPlanShape["edges"][number], stairs: DeckPlanShape["stairs"]): Pt {
  const len = e.lengthFeet;
  const t = { x: (e.b.x - e.a.x) / (len || 1), y: (e.b.y - e.a.y) / (len || 1) };
  const s = (p: Pt) => (p.x - e.a.x) * t.x + (p.y - e.a.y) * t.y;
  const off = (p: Pt) => Math.abs((p.x - e.a.x) * t.y - (p.y - e.a.y) * t.x);
  const gaps = stairs
    .filter((st) => off(st.top[0]) < 0.2 && off(st.top[1]) < 0.2)
    .map((st) => [Math.min(s(st.top[0]), s(st.top[1])), Math.max(s(st.top[0]), s(st.top[1]))] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  if (gaps.length === 0) return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
  let from = 0;
  let best: [number, number] = [0, 0];
  for (const [g0, g1] of [...gaps, [len, len] as [number, number]]) {
    if (g0 - from > best[1] - best[0]) best = [from, g0];
    from = Math.max(from, g1);
  }
  const mid = (best[0] + best[1]) / 2;
  return { x: e.a.x + t.x * mid, y: e.a.y + t.y * mid };
}

/** The stretches of a polygon a line through it covers, along the line: for drawing the boards. */
function chords(poly: Pt[], origin: Pt, dir: Pt, offset: number): [Pt, Pt][] {
  const nrm = { x: -dir.y, y: dir.x };
  const hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    const da = (a.x - origin.x) * nrm.x + (a.y - origin.y) * nrm.y - offset;
    const db = (b.x - origin.x) * nrm.x + (b.y - origin.y) * nrm.y - offset;
    if ((da < 0 && db >= 0) || (db < 0 && da >= 0)) {
      const t = da / (da - db);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      hits.push((p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y);
    }
  }
  hits.sort((a, b) => a - b);
  const base = { x: origin.x + nrm.x * offset, y: origin.y + nrm.y * offset };
  const out: [Pt, Pt][] = [];
  for (let k = 0; k + 1 < hits.length; k += 2) {
    const s0 = hits[k] as number;
    const s1 = hits[k + 1] as number;
    out.push([
      { x: base.x + dir.x * s0, y: base.y + dir.y * s0 },
      { x: base.x + dir.x * s1, y: base.y + dir.y * s1 },
    ]);
  }
  return out;
}

/** The decks on a plan, under or beside the house: each outline with its boards, railings by kind, stairs going down, posts and screens. */
export function DeckPlanMarks({ shapes, fs, names = true, dims = false }: { shapes: DeckPlanShape[]; fs: number; names?: boolean; dims?: boolean }) {
  return (
    <g pointerEvents="none">
      {shapes.map((d) => {
        const dir = d.boards;
        const nrm = { x: -dir.y, y: dir.x };
        const o = d.plan[0] as Pt;
        const offs = d.plan.map((p) => (p.x - o.x) * nrm.x + (p.y - o.y) * nrm.y);
        const lo = Math.min(...offs);
        const hi = Math.max(...offs);
        const boards: [Pt, Pt][] = [];
        // A board line every foot or so, fewer on a small drawing.
        const step = Math.max(0.5, fs * 0.9);
        for (let k = lo + step; k < hi - 1e-6; k += step) boards.push(...chords(d.plan, o, dir, k));
        const c = labelSpot(d.plan, fs);
        const post = Math.max(0.45, fs * 0.35);
        return (
          <g key={d.id}>
            <polygon points={pts(d.plan)} fill={DECK_PLAN_FILL} stroke="#6b5a48" strokeWidth={1.4} strokeLinejoin="round" {...stroke} />
            {boards.map(([a, b], i) => (
              <Line key={`b${i}`} a={a} b={b} ink="#b99d77" width={0.5} />
            ))}
            {d.stairs.map((s, i) => (
              <g key={`s${i}`}>
                <polygon points={pts([s.top[0], s.top[1], s.foot[1], s.foot[0]])} fill="#ffffff" stroke="#6b5a48" strokeWidth={1} {...stroke} />
                {s.treads.map(([a, b], k) => (
                  <Line key={k} a={a} b={b} ink="#8a7a66" width={0.6} />
                ))}
              </g>
            ))}
            {d.screens.map((s, i) => (
              <line key={`sc${i}`} x1={s.a.x} y1={Y(s.a.y)} x2={s.b.x} y2={Y(s.b.y)} stroke="#8a5a2b" strokeWidth={s.kind === "privacy" ? 4 : 2} strokeDasharray={s.kind === "skirting" ? "4 2" : undefined} strokeLinecap="butt" {...stroke} />
            ))}
            {d.railings.map((r, i) => {
              const st = RAIL_PLAN[r.kind];
              return <line key={`r${i}`} x1={r.a.x} y1={Y(r.a.y)} x2={r.b.x} y2={Y(r.b.y)} stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinecap="butt" {...stroke} />;
            })}
            {d.posts.map((p, i) => (
              <rect key={`p${i}`} x={p.x - post / 2} y={Y(p.y) - post / 2} width={post} height={post} fill="#ffffff" stroke={LINE} strokeWidth={0.8} {...stroke} />
            ))}
            {d.stairs.map((s, i) => {
              const mid = { x: (s.top[0].x + s.top[1].x) / 2, y: (s.top[0].y + s.top[1].y) / 2 };
              const foot = { x: (s.foot[0].x + s.foot[1].x) / 2, y: (s.foot[0].y + s.foot[1].y) / 2 };
              const len = Math.hypot(foot.x - mid.x, foot.y - mid.y);
              if (len < fs * 1.5) return null;
              const tip = { x: mid.x + (foot.x - mid.x) * 0.85, y: mid.y + (foot.y - mid.y) * 0.85 };
              const back = { x: tip.x - s.dir.x * fs * 0.5, y: tip.y - s.dir.y * fs * 0.5 };
              const side = { x: -s.dir.y * fs * 0.3, y: s.dir.x * fs * 0.3 };
              return (
                <g key={`a${i}`}>
                  <Line a={{ x: mid.x + (foot.x - mid.x) * 0.15, y: mid.y + (foot.y - mid.y) * 0.15 }} b={tip} ink="#4b5563" width={0.9} />
                  <polygon points={pts([tip, { x: back.x + side.x, y: back.y + side.y }, { x: back.x - side.x, y: back.y - side.y }])} fill="#4b5563" />
                </g>
              );
            })}
            {dims &&
              d.edges.map((e, i) => {
                if (e.lengthFeet < fs * 1.2) return null;
                const m = clearOfStairs(e, d.stairs);
                // Outside an open edge; inside one against the house.
                const k = e.ledger ? -1.1 : 1.1;
                const at = { x: m.x + e.out.x * fs * k, y: m.y + e.out.y * fs * k };
                const upright = Math.abs(e.b.y - e.a.y) > Math.abs(e.b.x - e.a.x);
                return (
                  <text key={`d${i}`} transform={`translate(${at.x} ${Y(at.y)})${upright ? " rotate(-90)" : ""}`} y={fs * 0.32} fontSize={fs * 0.85} textAnchor="middle" fill={e.ledger ? "#6b5a48" : INK} fontFamily={FONT}>
                    {formatFeetInches(e.lengthFeet)}
                    {e.ledger ? " ledger" : ""}
                  </text>
                );
              })}
            {names && (
              <text x={c.x} y={Y(c.y) + fs * 0.32} fontSize={fs * 0.85} textAnchor="middle" fill="#5b4630" fontFamily={FONT} fontStyle="italic">
                {d.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The part of a segment inside a box (Liang-Barsky); null when none of it is. */
function clipSegment(a: Pt, b: Pt, x0: number, x1: number, y0: number, y1: number): [[Pt, Pt]] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ] as [number, number][]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [
    [
      { x: a.x + dx * t0, y: a.y + dy * t0 },
      { x: a.x + dx * t1, y: a.y + dy * t1 },
    ],
  ];
}

/** The decks and their stairs as shapes a wall's name keeps off. */
export function deckObstacles(shapes: DeckPlanShape[] | undefined): Pt[][] {
  return (shapes ?? []).flatMap((d) => [d.plan, ...d.stairs.map((s) => [s.top[0], s.top[1], s.foot[1], s.foot[0]])]);
}

/** How far the decks reach on a plan, to frame it. */
export function deckPlanReach(shapes: DeckPlanShape[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const all = shapes.flatMap((d) => [...d.plan, ...d.stairs.flatMap((s) => [s.foot[0], s.foot[1]])]);
  if (all.length === 0) return null;
  return { minX: Math.min(...all.map((p) => p.x)), maxX: Math.max(...all.map((p) => p.x)), minY: Math.min(...all.map((p) => p.y)), maxY: Math.max(...all.map((p) => p.y)) };
}

/**
 * One deck on its own plan, for the report's deck pages: the house round it in grey, the deck with every edge's length
 * (its ledger said so), its railings by kind, stairs, posts and screens, and a key to the railings it has.
 */
export function DeckPlanDrawing({ footprint, shape, fontFeet, size }: { footprint: Footprint; shape: DeckPlanShape; fontFeet?: number; size?: { width: number; height: number } }) {
  const reach = deckPlanReach([shape]) as NonNullable<ReturnType<typeof deckPlanReach>>;
  const fs = fontFeet ?? Math.max(0.5, Math.max(reach.maxX - reach.minX, reach.maxY - reach.minY) * 0.04);
  const pad = Math.max(fs * 3.5, 4);
  const x0 = reach.minX - pad;
  const x1 = reach.maxX + pad;
  const y0 = reach.minY - pad;
  const y1 = reach.maxY + pad;
  const kinds = [...new Set(shape.railings.map((r) => r.kind))];
  const keyH = kinds.length > 0 ? fs * 1.6 : 0;
  // The house cut to the frame by hand: the report's own painter (lib/svgPdf.ts) draws no clip paths.
  const house = footprint.closes ? clipRect(footprint.corners, x0, x1, y0, y1) : [];
  const walls = footprint.closes ? footprint.corners.flatMap((a, i) => clipSegment(a, footprint.corners[(i + 1) % footprint.corners.length] as Pt, x0, x1, y0, y1) ?? []) : [];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x0} ${Y(y1)} ${x1 - x0} ${y1 - y0 + keyH}`} width={size?.width} height={size?.height} role="img" aria-label={`${shape.name}, plan, to scale`}>
      <rect x={x0} y={Y(y1)} width={x1 - x0} height={y1 - y0 + keyH} fill="#ffffff" />
      {house.length >= 3 && <polygon points={pts(house)} fill="#eceef1" />}
      {walls.map(([a, b], i) => (
        <Line key={`w${i}`} a={a} b={b} ink="#6b7280" width={1.6} />
      ))}
      <DeckPlanMarks shapes={[shape]} fs={fs} names={false} dims />
      {kinds.map((k, i) => {
        const st = RAIL_PLAN[k];
        const x = x0 + fs * 0.6 + i * fs * 9;
        const y = y0 - keyH * 0.55;
        return (
          <g key={k}>
            <line x1={x} x2={x + fs * 1.8} y1={Y(y)} y2={Y(y)} stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dash} {...stroke} />
            <text x={x + fs * 2.2} y={Y(y) + fs * 0.3} fontSize={fs * 0.8} fill={INK} fontFamily={FONT}>
              {k === "glass" ? "Glass railing" : k === "aluminum" ? "Aluminum pickets" : k === "wood" ? "Wood railing" : k === "cable" ? "Cable railing" : "Railing"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
