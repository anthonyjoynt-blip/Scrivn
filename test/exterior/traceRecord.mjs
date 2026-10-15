/**
 * Claude's answer to the AI trace, recovered from what the route sends back - so test:exterior:trace
 * can run on recorded answers and make no paid call (2026-10-15: the owner's API balance ran out on
 * development calls).
 *
 * The route answers with the proposals, not Claude's raw answer: `traceProposals` (lib/exteriorTrace.ts)
 * turns each pixel of the answer into the side's feet, and drops nothing a painted test scene has. Put
 * back through the squared image's frame, every point is the pixel Claude gave. `sameProposals` is
 * the proof: the recovered answer, read again as the route reads it, must give the proposals the
 * route gave, to a millionth. What cannot be put back - a turret's wall edges, a floor line's ends, a
 * hipped dormer's outline, an opening below the side's level - throws, or fails that proof, rather
 * than recording something Claude did not say.
 */

const FEET_PER_METRE = 1 / 0.3048;

/** The raw answer the route's [p] was read from, in the pixels of the squared image [frame]; [x] the lib's frameX/frameY. */
export function wireFromProposals(p, frame, x, { aprons = {} } = {}) {
  // To a ten-thousandth of a pixel: Claude answers in whole or tenth pixels, and the trip through feet adds float noise.
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const px = (pt) => [round(x.frameX(frame, pt.x / FEET_PER_METRE)), round(x.frameY(frame, pt.y / FEET_PER_METRE))];
  // A box in the side's feet as the pixel corners [left, top, right, bottom].
  const box = (b) => [...px({ x: b.x0, y: b.y1 }), ...px({ x: b.x1, y: b.y0 })];
  const wire = {
    materials: p.shapes.map((s) => ({ material: s.kind === "other" && s.label ? s.label.replace(/ /g, "_") : s.kind, polygon: s.polygon.map(px), partly_hidden_by: s.hiddenBy })),
    openings: p.openings.map((o) => {
      const b = o.box ?? { x0: o.fromLeftFeet, x1: o.fromLeftFeet + o.widthFeet, y0: o.sillFeet, y1: o.sillFeet + o.heightFeet };
      const [left, top, right, bottom] = box(b);
      return { kind: o.traced.replace(/ /g, "_"), left, right, top, bottom, measured_to: o.measuredTo.replace(/ /g, "_"), leaf: o.leaf ? box(o.leaf) : [], partly_hidden_by: o.hiddenBy };
    }),
    wall_top: p.wallTop ? p.wallTop.line.map(px) : [],
    off_wall: p.offWall.map((b) => ({ what: b.what, box: box(b) })),
    notes: p.notes,
  };
  const r = p.roof;
  if (r) {
    wire.roof = {
      over_wall: r.said,
      rake_left: r.lines.rakeLeft.map(px),
      rake_right: r.lines.rakeRight.map(px),
      eave_line: r.lines.eave.map(px),
      left_end: { kind: r.ends.left, point: r.lines.leftEnd ? px(r.lines.leftEnd) : [] },
      right_end: { kind: r.ends.right, point: r.lines.rightEnd ? px(r.lines.rightEnd) : [] },
      notes: r.notes,
    };
  }
  if (p.pieces !== undefined || p.storeys !== undefined) {
    const s = p.storeys;
    if (s?.floorLineFeet != null) throw new Error("A floor line keeps only its height, not its ends: record this scene from a live answer.");
    wire.roof_shapes = {
      pieces: (p.pieces ?? []).map((q) => {
        if (q.piece.kind.endsWith("Turret")) throw new Error("A turret keeps no wall edges in its proposal: record this scene from a live answer.");
        // A dormer's outline is its apron's first end, its face top, its apron's last end: [aprons][key] when its apron had one point.
        const n = q.piece.seen.apronFeet === null ? 0 : (aprons[q.key] ?? 2);
        const flat = (pts) => pts.flatMap(px);
        const out = q.outline;
        const foot = n === 0 ? [] : n === 1 ? [out[0]] : [out[0], out[out.length - 1]];
        const top = out.slice(n === 0 ? 0 : 1, n === 2 ? -1 : undefined);
        return { kind: q.piece.kind === "gableDormer" ? "gable_dormer" : "shed_dormer", outline: flat(top), foot: flat(foot), sides: 0 };
      }),
      upper_floor: s?.upper === "setBack" ? "set_back" : (s?.upper ?? "unclear"),
      floor_line: [],
      lower_roof: s?.lowerRoof === "leanto" ? "lean_to" : s?.lowerRoof === "tent" ? "ridge_out" : "none",
      notes: s?.notes ?? "",
    };
  }
  return wire;
}

/** Where [a] and [b] differ, as JSON reads them: a number by more than a millionth of itself; null when nowhere. */
export function proposalsDiffer(a, b, path = "") {
  const A = JSON.parse(JSON.stringify(a));
  const B = JSON.parse(JSON.stringify(b));
  const walk = (u, v, at) => {
    if (typeof u === "number" && typeof v === "number") return Math.abs(u - v) <= 1e-6 * Math.max(1, Math.abs(u)) ? null : `${at}: ${u} against ${v}`;
    if (Array.isArray(u) || Array.isArray(v)) {
      if (!Array.isArray(u) || !Array.isArray(v) || u.length !== v.length) return `${at}: ${JSON.stringify(u)?.slice(0, 80)} against ${JSON.stringify(v)?.slice(0, 80)}`;
      for (let i = 0; i < u.length; i++) {
        const d = walk(u[i], v[i], `${at}[${i}]`);
        if (d) return d;
      }
      return null;
    }
    if (u && v && typeof u === "object" && typeof v === "object") {
      const keys = [...new Set([...Object.keys(u), ...Object.keys(v)])];
      for (const k of keys) {
        const d = walk(u[k], v[k], `${at}.${k}`);
        if (d) return d;
      }
      return null;
    }
    return u === v ? null : `${at}: ${JSON.stringify(u)} against ${JSON.stringify(v)}`;
  };
  return walk(A, B, path || "proposals");
}
