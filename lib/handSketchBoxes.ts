/**
 * Finding the rooms in a photo of a hand-drawn sketch without AI (2026-11-06): the free path on the drop-a-sketch page.
 * The person then only types the numbers, wall by wall, instead of tapping every corner.
 *
 * Plain image work, run in the browser on the photo's pixels:
 *   1. ink: pixels clearly darker than the paper around them and not blue (so a graph-paper grid and a shadow across the
 *      page are not ink);
 *   2. straight strokes: lines through the ink, taken one at a time, strongest first (a Hough transform), each split
 *      into its inked runs; short runs (handwriting) are dropped;
 *   3. strokes that are one wall drawn in two goes are joined;
 *   4. where strokes meet or nearly meet (a hand-drawn corner overshoots or stops short) is a corner;
 *   5. the closed shapes the strokes make are the rooms.
 *
 * Lines inside a room that touch its walls (a tub's edge, a vanity) close shapes too: those come out as rooms, which the
 * person joins back into the room with one tap (joinRooms). Nothing here reads a number.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, as ImageData.data. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface FoundRoom {
  /** In the photo's own pixels, going round the room. */
  corners: { x: number; y: number }[];
}

export interface FoundBoxes {
  rooms: FoundRoom[];
  /** The strokes taken as walls, in the photo's pixels: for drawing what was found over the photo. */
  strokes: { a: { x: number; y: number }; b: { x: number; y: number } }[];
  /** The corners and walls between them, before the closed shapes are taken: for checking what was joined. */
  graph: { nodes: { x: number; y: number }[]; edges: [number, number][] };
  /**
   * Door swings: a short line drawn from a wall out into a room at a slant, its far end clear of every wall (a door
   * drawn open). The hinge is where it meets the wall. Only a likely door: the person is asked.
   */
  swings: { hinge: { x: number; y: number }; tip: { x: number; y: number } }[];
}

/** The long side the photo is worked at: enough for a pen line to be two or three pixels wide. */
const WORK_EDGE = 720;

interface Seg {
  /** A point on the line, its unit direction, and the run along it. */
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  t0: number;
  t1: number;
  n: number;
}

const segEnd = (s: Seg, t: number) => ({ x: s.cx + s.dx * t, y: s.cy + s.dy * t });

/** Luminance and blueness at the working size, by averaging the photo's pixels into each working pixel. */
function shrink(px: Pixels): { w: number; h: number; k: number; lum: Float32Array; blue: Float32Array } {
  const k = Math.max(1, Math.max(px.width, px.height) / WORK_EDGE);
  const w = Math.max(1, Math.round(px.width / k));
  const h = Math.max(1, Math.round(px.height / k));
  const sum = new Float32Array(w * h);
  const sumB = new Float32Array(w * h);
  const cnt = new Float32Array(w * h);
  const d = px.data;
  for (let y = 0; y < px.height; y++) {
    const wy = Math.min(h - 1, Math.floor(y / k));
    for (let x = 0; x < px.width; x++) {
      const i = (y * px.width + x) * 4;
      const wi = wy * w + Math.min(w - 1, Math.floor(x / k));
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      sum[wi]! += 0.299 * r + 0.587 * g + 0.114 * b;
      sumB[wi]! += b - (r + g) / 2;
      cnt[wi]!++;
    }
  }
  for (let i = 0; i < w * h; i++) {
    sum[i]! /= cnt[i]! || 1;
    sumB[i]! /= cnt[i]! || 1;
  }
  return { w, h, k, lum: sum, blue: sumB };
}

/** A box mean of radius r (an integral image). */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]!;
      ii[(y + 1) * (w + 1) + x + 1]! = ii[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = ii[y1 * (w + 1) + x1]! - ii[y0 * (w + 1) + x1]! - ii[y1 * (w + 1) + x0]! + ii[y0 * (w + 1) + x0]!;
      out[y * w + x]! = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * Ink: darker than the paper round it by a good share, and no bluer than that paper would be in shade. The paper's own
 * level and tint come from the brighter pixels nearby, so a shadow lowers the paper with it.
 */
export function inkMask(px: Pixels): { w: number; h: number; k: number; ink: Uint8Array } {
  const { w, h, k, lum, blue } = shrink(px);
  const r = Math.max(6, Math.round(Math.max(w, h) / 40));
  const first = boxMean(lum, w, h, r);
  const paperOnly = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) paperOnly[i]! = lum[i]! < first[i]! - 12 ? first[i]! : lum[i]!;
  const paper = boxMean(paperOnly, w, h, r);
  // The paper's tint: its blueness, taken from the cells that are not marked.
  const clear = new Float32Array(w * h);
  const clearBlue = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (lum[i]! >= first[i]! - 12) {
      clear[i]! = 1;
      clearBlue[i]! = blue[i]!;
    }
  }
  const nClear = boxMean(clear, w, h, r);
  const sumBlue = boxMean(clearBlue, w, h, r);
  // Each photo pixel judged on its own, before any averaging washes a grid line's blue out: a pen line is most of the
  // way to black from the paper and has no colour of its own; a printed grid line is part of the way, and bluish.
  const hits = new Uint8Array(w * h);
  const d = px.data;
  for (let y = 0; y < px.height; y++) {
    const wy = Math.min(h - 1, Math.floor(y / k));
    for (let x = 0; x < px.width; x++) {
      const wi = wy * w + Math.min(w - 1, Math.floor(x / k));
      const i = (y * px.width + x) * 4;
      const R = d[i]!;
      const G = d[i + 1]!;
      const B = d[i + 2]!;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      const P = Math.max(60, paper[wi]!);
      const dark = P - L;
      if (dark / P < 0.5) continue;
      // Pen ink takes light away evenly, so a pen line is the paper's own tint, darker. A printed grid line lets blue
      // through: measured on graph paper in daylight and in a hand's shadow, a grid line came out bluer than the paper
      // by 0.11 to 0.23 of its darkness, a pen line by -0.12 to -0.02. (By darkness alone a thin pen line and a grid
      // line are the same, 70% of the way to black.)
      const paperBlue = sumBlue[wi]! / Math.max(1e-6, nClear[wi]!);
      if (B - (R + G) / 2 - (paperBlue * L) / P > 0.05 * dark) continue;
      hits[wi]!++;
    }
  }
  const need = Math.max(1, Math.round((k * k) / 4));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (hits[i]! >= need) ink[i]! = 1;
  return { w, h, k, ink };
}

/** The straight strokes in the ink, strongest line first; each line's inked pixels are used up as it is taken. */
function strokes(ink: Uint8Array, w: number, h: number): Seg[] {
  const pts: number[] = [];
  for (let i = 0; i < w * h; i++) if (ink[i]!) pts.push(i);
  const nT = 180;
  const cos = new Float32Array(nT);
  const sin = new Float32Array(nT);
  for (let t = 0; t < nT; t++) {
    cos[t]! = Math.cos((t * Math.PI) / nT);
    sin[t]! = Math.sin((t * Math.PI) / nT);
  }
  const diag = Math.ceil(Math.hypot(w, h));
  const nR = 2 * diag + 1;
  const acc = new Int32Array(nT * nR);
  const used = new Uint8Array(w * h);
  const vote = (i: number, s: number) => {
    const x = i % w;
    const y = (i - x) / w;
    for (let t = 0; t < nT; t++) acc[t * nR + Math.round(x * cos[t]! + y * sin[t]!) + diag]! += s;
  };
  for (const i of pts) vote(i, 1);

  const short = Math.min(w, h);
  const minRun = Math.max(18, Math.round(short * 0.07));
  // A pen line fades for a moment here and there (more so in a smaller photo); the share inked, below, keeps a dashed
  // line out.
  const gap = Math.max(6, Math.round(short * 0.022));
  const band = 3.5;
  const out: Seg[] = [];
  for (let guard = 0; guard < 400; guard++) {
    let best = 0;
    let bi = -1;
    for (let i = 0; i < acc.length; i++) if (acc[i]! > best) ((best = acc[i]!), (bi = i));
    if (best < minRun * 0.8) break;
    const t = Math.floor(bi / nR);
    const rho = (bi % nR) - diag;
    // The line's inked pixels, refined once: the band's pixels fitted, then the band taken again round the fit.
    let nx = cos[t]!;
    let ny = sin[t]!;
    let c = rho;
    let take: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
      take = [];
      for (const i of pts) {
        if (used[i]!) continue;
        const x = i % w;
        const y = (i - x) / w;
        if (Math.abs(x * nx + y * ny - c) <= band) take.push(i);
      }
      if (take.length < 3) break;
      let mx = 0;
      let my = 0;
      for (const i of take) ((mx += i % w), (my += Math.floor(i / w)));
      mx /= take.length;
      my /= take.length;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const i of take) {
        const ex = (i % w) - mx;
        const ey = Math.floor(i / w) - my;
        sxx += ex * ex;
        syy += ey * ey;
        sxy += ex * ey;
      }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // the direction of most spread
      const fx = -Math.sin(ang);
      const fy = Math.cos(ang);
      // Only take the refit while it stays near the voted line: a crowd of handwriting can pull a fit off it.
      const turn = Math.abs(fx * nx + fy * ny);
      if (turn < Math.cos((4 * Math.PI) / 180)) break;
      nx = fx * Math.sign(fx * nx + fy * ny || 1);
      ny = fy * Math.sign(fx * cos[t]! + fy * sin[t]! || 1);
      c = mx * nx + my * ny;
    }
    const dx = -ny;
    const dy = nx;
    const cx = nx * c;
    const cy = ny * c;
    const along = take.map((i) => ({ i, s: ((i % w) - cx) * dx + (Math.floor(i / w) - cy) * dy })).sort((a, b) => a.s - b.s);
    // Split into inked runs; keep the long ones, and use up their pixels (and the band's pixels next to them).
    let start = 0;
    let taken = 0;
    for (let j = 1; j <= along.length; j++) {
      if (j < along.length && along[j]!.s - along[j - 1]!.s <= gap) continue;
      const run = along.slice(start, j);
      start = j;
      const len = run.length ? run[run.length - 1]!.s - run[0]!.s : 0;
      if (len < minRun) continue;
      // A pen line is inked nearly all along; a printed grid, once its blue is gone, is left as dashes.
      const covered = new Set(run.map((p) => Math.floor(p.s))).size;
      if (covered < len * 0.85) continue;
      out.push({ cx, cy, dx, dy, t0: run[0]!.s, t1: run[run.length - 1]!.s, n: run.length });
      for (const p of run) {
        if (used[p.i]!) continue;
        used[p.i]! = 1;
        vote(p.i, -1);
        taken++;
      }
    }
    if (taken === 0) {
      // Nothing long on this line: it is spent, so its votes go and the next line is looked at.
      acc[bi]! = 0;
    }
  }
  return out;
}

/** Strokes that are one wall drawn in two goes (or a thick line read twice): the same line, touching or overlapping. */
function joinStrokes(segs: Seg[], gap: number): Seg[] {
  const list = segs.slice();
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const dot = a.dx * b.dx + a.dy * b.dy;
        if (Math.abs(dot) < Math.cos((6 * Math.PI) / 180)) continue;
        const b0 = segEnd(b, b.t0);
        const b1 = segEnd(b, b.t1);
        const off = (p: { x: number; y: number }) => Math.abs((p.x - a.cx) * -a.dy + (p.y - a.cy) * a.dx);
        if (off(b0) > 6 || off(b1) > 6) continue;
        const s0 = (b0.x - a.cx) * a.dx + (b0.y - a.cy) * a.dy;
        const s1 = (b1.x - a.cx) * a.dx + (b1.y - a.cy) * a.dy;
        const lo = Math.min(s0, s1);
        const hi = Math.max(s0, s1);
        if (lo > a.t1 + gap || hi < a.t0 - gap) continue;
        // One line through both, weighted by their ink.
        const pa = segEnd(a, (a.t0 + a.t1) / 2);
        const pb = segEnd(b, (b.t0 + b.t1) / 2);
        const sgn = dot < 0 ? -1 : 1;
        let dx = a.dx * a.n + b.dx * sgn * b.n;
        let dy = a.dy * a.n + b.dy * sgn * b.n;
        const l = Math.hypot(dx, dy);
        dx /= l;
        dy /= l;
        const cx = (pa.x * a.n + pb.x * b.n) / (a.n + b.n);
        const cy = (pa.y * a.n + pb.y * b.n) / (a.n + b.n);
        const ends = [segEnd(a, a.t0), segEnd(a, a.t1), b0, b1].map((p) => (p.x - cx) * dx + (p.y - cy) * dy);
        list[i]! = { cx, cy, dx, dy, t0: Math.min(...ends), t1: Math.max(...ends), n: a.n + b.n };
        list.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return list;
}

interface Graph {
  nodes: { x: number; y: number }[];
  edges: [number, number][];
  /** Corners that are only where two pieces of one bowed wall were joined end to end: bends, not corners. */
  soft: boolean[];
}

/**
 * Corners where strokes cross or nearly meet (each may be stretched a little past its ends, as a hand-drawn corner
 * stops short), merged when close; the walls are the pieces of each stroke between its corners.
 */
function cornersAndWalls(segs: Seg[], reach: number, mergeR: number, ink: Uint8Array, w: number, h: number): Graph {
  const raw: { x: number; y: number; soft: boolean }[] = [];
  const onSeg: { t: number; node: number }[][] = segs.map(() => []);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]!;
      const b = segs[j]!;
      const cross = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(cross) < Math.sin((20 * Math.PI) / 180)) {
        // Nearly the same way: a bowed wall drawn as one stroke is found as pieces at slightly different angles, end
        // to end. Ends that nearly touch are joined (the corner it makes there is straightened out later).
        let near: { ta: number; tb: number; d: number } | null = null;
        for (const ta of [a.t0, a.t1])
          for (const tb of [b.t0, b.t1]) {
            const pa = segEnd(a, ta);
            const pb = segEnd(b, tb);
            const dd = Math.hypot(pa.x - pb.x, pa.y - pb.y);
            if (dd <= reach && (!near || dd < near.d)) near = { ta, tb, d: dd };
          }
        if (near) {
          const pa = segEnd(a, near.ta);
          const pb = segEnd(b, near.tb);
          const id = raw.length;
          raw.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, soft: true });
          onSeg[i]!.push({ t: near.ta, node: id });
          onSeg[j]!.push({ t: near.tb, node: id });
        }
        continue;
      }
      const qx = b.cx - a.cx;
      const qy = b.cy - a.cy;
      const ta = (qx * b.dy - qy * b.dx) / cross;
      const tb = (qx * a.dy - qy * a.dx) / cross;
      if (ta < a.t0 - reach || ta > a.t1 + reach || tb < b.t0 - reach || tb > b.t1 + reach) continue;
      const id = raw.length;
      raw.push({ ...segEnd(a, ta), soft: false });
      onSeg[i]!.push({ t: ta, node: id });
      onSeg[j]!.push({ t: tb, node: id });
    }
  }
  // Close corners are one corner.
  const parent = raw.map((_, i) => i);
  const find = (i: number): number => (parent[i]! === i ? i : (parent[i]! = find(parent[i]!)));
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) if (Math.hypot(raw[i]!.x - raw[j]!.x, raw[i]!.y - raw[j]!.y) <= mergeR) parent[find(i)]! = find(j);
  const idOf = new Map<number, number>();
  const nodes: { x: number; y: number; n: number; soft: boolean }[] = [];
  raw.forEach((p, i) => {
    const r = find(i);
    if (!idOf.has(r)) {
      idOf.set(r, nodes.length);
      nodes.push({ x: 0, y: 0, n: 0, soft: true });
    }
    const nd = nodes[idOf.get(r)!]!;
    nd.x += p.x;
    nd.y += p.y;
    nd.n++;
    nd.soft &&= p.soft;
  });
  for (const nd of nodes) ((nd.x /= nd.n), (nd.y /= nd.n));
  const inkAt = (x: number, y: number) => {
    for (let oy = -2; oy <= 2; oy++)
      for (let ox = -2; ox <= 2; ox++) {
        const xi = Math.round(x) + ox;
        const yi = Math.round(y) + oy;
        if (xi >= 0 && yi >= 0 && xi < w && yi < h && ink[yi * w + xi]!) return true;
      }
    return false;
  };
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  onSeg.forEach((list, si) => {
    const seg = segs[si]!;
    const ids = list.map((e) => ({ t: e.t, node: idOf.get(find(e.node))! })).sort((a, b) => a.t - b.t);
    for (let k = 1; k < ids.length; k++) {
      const u = ids[k - 1]!.node;
      const v = ids[k]!.node;
      if (u === v) continue;
      // A wall only where there is ink along most of it: of the part the stroke was drawn over. The stretch past the
      // stroke's end to a corner (a hand-drawn corner stops short, or curls) is taken as it is.
      const A = nodes[u]!;
      const B = nodes[v]!;
      const ta = ids[k - 1]!.t;
      const tb = ids[k]!.t;
      const f0 = (Math.max(ta, seg.t0) - ta) / (tb - ta);
      const f1 = (Math.min(tb, seg.t1) - ta) / (tb - ta);
      const drawn = (f1 - f0) * Math.hypot(B.x - A.x, B.y - A.y);
      if (drawn > 4) {
        const steps = Math.max(2, Math.round(drawn / 2));
        let hit = 0;
        for (let s = 0; s <= steps; s++) {
          const fr = f0 + ((f1 - f0) * s) / steps;
          // Along the stroke itself, which was fitted to this ink: a bowed line strays off the straight corner-to-corner.
          const on = segEnd(seg, ta + (tb - ta) * fr);
          if (inkAt(on.x, on.y)) hit++;
        }
        if (hit / (steps + 1) < 0.7) continue;
      } else if (f1 - f0 < 0 && Math.hypot(B.x - A.x, B.y - A.y) > reach) continue;
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([u, v]);
    }
  });
  // Two corners with an unbroken line of ink straight between them are joined, though no stroke was found there (its
  // ink taken by a scribble beside it, or the line too short to stand out): no other corner may sit on the way.
  const inkShare = (A: { x: number; y: number }, B: { x: number; y: number }) => {
    const steps = Math.max(2, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 2));
    let hit = 0;
    for (let s = 0; s <= steps; s++) if (inkAt(A.x + ((B.x - A.x) * s) / steps, A.y + ((B.y - A.y) * s) / steps)) hit++;
    return hit / (steps + 1);
  };
  for (let u = 0; u < nodes.length; u++)
    for (let v = u + 1; v < nodes.length; v++) {
      if (seen.has(`${u},${v}`)) continue;
      const A = nodes[u]!;
      const B = nodes[v]!;
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      if (len < mergeR * 2) continue;
      const between = nodes.some((N, i) => {
        if (i === u || i === v) return false;
        const t = ((N.x - A.x) * (B.x - A.x) + (N.y - A.y) * (B.y - A.y)) / (len * len);
        if (t <= 0 || t >= 1) return false;
        return Math.hypot(A.x + (B.x - A.x) * t - N.x, A.y + (B.y - A.y) * t - N.y) <= mergeR;
      });
      if (between || inkShare(A, B) < 0.92) continue;
      seen.add(`${u},${v}`);
      edges.push([u, v]);
    }
  return { nodes: nodes.map((n) => ({ x: n.x, y: n.y })), edges, soft: nodes.map((n) => n.soft) };
}

/** Walls hanging free (a door swing, a wall that stops) close nothing: they come off, until none is left. */
function closingWalls(edges: [number, number][]): [number, number][] {
  let out = edges.slice();
  for (;;) {
    const deg = new Map<number, number>();
    for (const [u, v] of out) {
      deg.set(u, (deg.get(u) ?? 0) + 1);
      deg.set(v, (deg.get(v) ?? 0) + 1);
    }
    const kept = out.filter(([u, v]) => (deg.get(u) ?? 0) > 1 && (deg.get(v) ?? 0) > 1);
    if (kept.length === out.length) return out;
    out = kept;
  }
}

/** The closed shapes of a drawing's walls: each face of the plane they divide (the outside among them). */
function faces(nodes: { x: number; y: number }[], edges: [number, number][]): number[][] {
  const nbr = new Map<number, number[]>();
  for (const [u, v] of edges) {
    (nbr.get(u) ?? nbr.set(u, []).get(u)!).push(v);
    (nbr.get(v) ?? nbr.set(v, []).get(v)!).push(u);
  }
  const ang = (u: number, v: number) => Math.atan2(nodes[v]!.y - nodes[u]!.y, nodes[v]!.x - nodes[u]!.x);
  for (const [u, list] of nbr) list.sort((a, b) => ang(u, a) - ang(u, b));
  const done = new Set<string>();
  const out: number[][] = [];
  for (const [u0, v0] of edges.flatMap(([u, v]): [number, number][] => [
    [u, v],
    [v, u],
  ])) {
    if (done.has(`${u0},${v0}`)) continue;
    const loop: number[] = [];
    let u = u0;
    let v = v0;
    for (let guard = 0; guard < 1000; guard++) {
      done.add(`${u},${v}`);
      loop.push(u);
      // Turn as far as possible one way at each corner: the next wall round v after the one back to u.
      const list = nbr.get(v)!;
      const k = list.indexOf(u);
      const w = list[(k - 1 + list.length) % list.length]!;
      u = v;
      v = w;
      if (u === u0 && v === v0) break;
    }
    out.push(loop);
  }
  return out;
}

const area = (p: { x: number; y: number }[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

const offLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / l;
};

const turnDeg = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
  let t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
  if (t > Math.PI) t = 2 * Math.PI - t;
  return (t * 180) / Math.PI;
};

interface Wall {
  a: number;
  b: number;
  /** The corners it was drawn through, a to b: a bowed wall's bends, a scribbled wall's wobbles. */
  path: number[];
}

/**
 * Corners that are not corners taken out, the walls either side made one: a bend in a bowed wall, a wobble on a
 * scribbled one, a straight run's middle. Decided on the walls themselves rather than room by room, so two rooms that
 * share a wall keep the same corners on it. A corner where three or more walls meet always stays.
 */
function straighten(g: Graph, edges: [number, number][], tol: number): Wall[] {
  const walls = new Map<string, Wall>();
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (const [u, v] of edges) walls.set(key(u, v), { a: u, b: v, path: [u, v] });
  const nbr = () => {
    const m = new Map<number, number[]>();
    for (const wl of walls.values()) {
      (m.get(wl.a) ?? m.set(wl.a, []).get(wl.a)!).push(wl.b);
      (m.get(wl.b) ?? m.set(wl.b, []).get(wl.b)!).push(wl.a);
    }
    return m;
  };
  for (let guard = 0; guard < 500; guard++) {
    const m = nbr();
    let best: { v: number; a: number; b: number; score: number } | null = null;
    for (const [v, list] of m) {
      if (list.length !== 2) continue;
      const [a, b] = list as [number, number];
      if (walls.has(key(a, b))) continue; // taking v out would lay one wall on another
      const P = g.nodes;
      const off = offLine(P[v]!, P[a]!, P[b]!);
      const turn = turnDeg(P[a]!, P[v]!, P[b]!);
      // A hand-drawn wall bows by up to a tenth of its length, turning by a fair angle where it does; a corner turns
      // more, or stands further off the line.
      const chord = Math.hypot(P[b]!.x - P[a]!.x, P[b]!.y - P[a]!.y);
      const bend = g.soft[v]! || turn < 14 || off < tol || (turn < 35 && off < 0.12 * chord);
      if (!bend) continue;
      const score = g.soft[v]! ? -1 : off;
      if (!best || score < best.score) best = { v, a, b, score };
    }
    if (!best) break;
    const { v, a, b } = best;
    const wa = walls.get(key(a, v))!;
    const wb = walls.get(key(v, b))!;
    const pa = wa.a === a ? wa.path : wa.path.slice().reverse(); // a ... v
    const pb = wb.a === v ? wb.path : wb.path.slice().reverse(); // v ... b
    walls.delete(key(a, v));
    walls.delete(key(v, b));
    walls.set(key(a, b), { a, b, path: [...pa, ...pb.slice(1)] });
  }
  return [...walls.values()];
}

/**
 * Each wall's own straight line, fitted to the ink along everything it was drawn through (so a bowed wall becomes the
 * line through the middle of its bow), and each corner put where its walls' lines cross. A hand-drawn corner stops
 * short, overshoots or curls; where the walls point is where it was meant to be.
 */
function refine(g: Graph, walls: Wall[], ink: Uint8Array, w: number, h: number, tol: number): { x: number; y: number }[] {
  const P = g.nodes;
  const lines = new Map<Wall, { px: number; py: number; dx: number; dy: number }>();
  for (const wl of walls) {
    const pts: { x: number; y: number }[] = [];
    const A = P[wl.a]!;
    const B = P[wl.b]!;
    const skip = Math.min(tol, Math.hypot(B.x - A.x, B.y - A.y) / 4);
    for (let s = 1; s < wl.path.length; s++) {
      const p = P[wl.path[s - 1]!]!;
      const q = P[wl.path[s]!]!;
      const x0 = Math.max(0, Math.floor(Math.min(p.x, q.x) - 3));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(p.x, q.x) + 3));
      const y0 = Math.max(0, Math.floor(Math.min(p.y, q.y) - 3));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(p.y, q.y) + 3));
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (!ink[y * w + x]!) continue;
          const t = ((x - p.x) * (q.x - p.x) + (y - p.y) * (q.y - p.y)) / (len * len);
          if (t < 0 || t > 1) continue;
          if (offLine({ x, y }, p, q) > 3) continue;
          // Away from the corners, where the next wall's ink would pull the line round.
          if (Math.hypot(x - A.x, y - A.y) < skip || Math.hypot(x - B.x, y - B.y) < skip) continue;
          pts.push({ x, y });
        }
    }
    if (pts.length < 8) continue;
    let mx = 0;
    let my = 0;
    for (const p of pts) ((mx += p.x), (my += p.y));
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.set(wl, { px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  return P.map((p, i) => {
    const own = walls.filter((wl) => wl.a === i || wl.b === i).map((wl) => lines.get(wl)).filter((l) => !!l);
    if (own.length < 2) return p;
    // The point nearest all its walls' lines (two lines: where they cross), when they are not near parallel.
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const l of own) {
      const nx = -l.dy;
      const ny = l.dx;
      const c = nx * l.px + ny * l.py;
      a11 += nx * nx;
      a12 += nx * ny;
      a22 += ny * ny;
      b1 += nx * c;
      b2 += ny * c;
    }
    const det = a11 * a22 - a12 * a12;
    if (det < Math.sin((15 * Math.PI) / 180) ** 2) return p;
    const q = { x: (b1 * a22 - b2 * a12) / det, y: (a11 * b2 - a12 * b1) / det };
    // A refit that runs off somewhere else is not trusted.
    return Math.hypot(q.x - p.x, q.y - p.y) <= tol * 3 ? q : p;
  });
}

/** The rooms drawn in a photo of a hand sketch, found without reading anything; see the top of this file. */
export function findBoxes(px: Pixels): FoundBoxes {
  const { w, h, k, ink } = inkMask(px);
  const short = Math.min(w, h);
  const segs = joinStrokes(strokes(ink, w, h), Math.max(6, short * 0.03));
  const g = cornersAndWalls(segs, short * 0.05, short * 0.025, ink, w, h);
  const tol = short * 0.02;
  const minArea = w * h * 0.004;
  // A wall drawn over twice, or scribbled, leaves slivers between its strokes: each goes, by its longest side, until
  // none is left; the strokes either side then straighten into one wall.
  let edges = closingWalls(g.edges);
  for (let guard = 0; guard < 100; guard++) {
    const slivers = faces(g.nodes, edges)
      .map((loop) => ({ loop, a: area(loop.map((i) => g.nodes[i]!)) }))
      .filter((f) => f.a > 0 && f.a < minArea)
      .sort((x, y) => x.a - y.a);
    const sl = slivers[0]!;
    if (!sl) break;
    let longest = -1;
    let len = -1;
    sl.loop.forEach((u, i) => {
      const v = sl.loop[(i + 1) % sl.loop.length]!;
      const l = Math.hypot(g.nodes[v]!.x - g.nodes[u]!.x, g.nodes[v]!.y - g.nodes[u]!.y);
      if (l > len) ((len = l), (longest = i));
    });
    const u = sl.loop[longest]!;
    const v = sl.loop[(longest + 1) % sl.loop.length]!;
    edges = closingWalls(edges.filter(([a, b]) => !((a === u && b === v) || (a === v && b === u))));
  }
  const walls = straighten(g, edges, tol);
  const at = refine(g, walls, ink, w, h, tol);
  const shapes = faces(
    at,
    walls.map((wl) => [wl.a, wl.b] as [number, number]),
  )
    .map((loop) => loop.map((i) => at[i]!))
    .filter((p) => p.length >= 3 && area(p) > minArea); // the outside comes round the other way, so its area is negative
  const scale = (p: { x: number; y: number }) => ({ x: Math.round(p.x * k), y: Math.round(p.y * k) });
  const wallLines = walls.map((wl) => [at[wl.a]!, at[wl.b]!] as const);
  const toWall = (p: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }) => {
    const l2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / l2));
    const q = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
  };
  const reach = short * 0.05;
  const swings: FoundBoxes["swings"] = [];
  for (const sg of segs) {
    const len = sg.t1 - sg.t0;
    if (len < short * 0.05 || len > short * 0.35) continue;
    const ends = [segEnd(sg, sg.t0), segEnd(sg, sg.t1)];
    for (const [hinge, tip] of [
      [ends[0]!, ends[1]!],
      [ends[1]!, ends[0]!],
    ] as const) {
      let best: { d: number; q: { x: number; y: number }; A: { x: number; y: number }; B: { x: number; y: number } } | null = null;
      for (const [A, B] of wallLines) {
        const m = toWall(hinge, A, B);
        if (m.d <= reach && (!best || m.d < best.d)) best = { ...m, A, B };
      }
      if (!best) continue;
      // A wall stroke, or a line from wall to wall (a tub's edge), ends on a wall at both ends.
      if (wallLines.some(([A, B]) => toWall(tip, A, B).d < len * 0.35)) continue;
      const lx = tip.x - hinge.x;
      const ly = tip.y - hinge.y;
      const wx = best.B.x - best.A.x;
      const wy = best.B.y - best.A.y;
      const ang = (Math.acos(Math.min(1, Math.abs(lx * wx + ly * wy) / (Math.hypot(lx, ly) * Math.hypot(wx, wy) || 1))) * 180) / Math.PI;
      // Drawn open at about 45 degrees; a line square to the wall is a fixture's side, one along it a wall.
      if (ang < 25 || ang > 65) continue;
      // A door leaf's free end stands alone; a stroke of handwriting has the other letters beside it.
      const R = Math.max(8, Math.round(short * 0.03));
      let crowd = 0;
      for (let y = Math.max(0, Math.round(tip.y) - R); y <= Math.min(h - 1, Math.round(tip.y) + R); y++)
        for (let x = Math.max(0, Math.round(tip.x) - R); x <= Math.min(w - 1, Math.round(tip.x) + R); x++) {
          if (!ink[y * w + x] || Math.hypot(x - tip.x, y - tip.y) > R) continue;
          if (Math.abs((x - sg.cx) * -sg.dy + (y - sg.cy) * sg.dx) <= 3) continue; // its own line
          crowd++;
        }
      if (crowd > R) continue;
      swings.push({ hinge: scale(best.q), tip: scale(tip) });
      break;
    }
  }
  return {
    swings,
    rooms: shapes.map((p) => ({ corners: p.map(scale) })),
    strokes: segs.map((s) => ({ a: scale(segEnd(s, s.t0)), b: scale(segEnd(s, s.t1)) })),
    graph: { nodes: at.map(scale), edges: walls.map((wl) => [wl.a, wl.b] as [number, number]) },
  };
}
