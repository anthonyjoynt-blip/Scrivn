/**
 * A built room against the owner's tape of the same room: wall by wall, then each door, window and
 * fixture against the tape's of the same kind on the same wall. Shared by run.mjs (hand-written
 * reads) and live.mjs (a model's read), so the two are scored the same way.
 */

const lengths = (room) =>
  room.vertices.map((v, i) => {
    const w = room.vertices[(i + 1) % room.vertices.length];
    return Math.hypot(w.x - v.x, w.y - v.y);
  });

/**
 * Room [a]'s wall i is [b]'s wall map[i]: the cyclic pairing, either way round, closest in length.
 * A rectangle pairs as well four ways round, so among pairings within an inch or two of the best,
 * the one that puts the most doors, windows and fixtures on the same walls as the tape's wins.
 */
export function pairWalls(a, b) {
  const la = lengths(a);
  const lb = lengths(b);
  const n = la.length;
  if (lb.length !== n) return null;
  const all = [];
  for (const dir of [1, -1])
    for (let shift = 0; shift < n; shift++) {
      const map = la.map((_, i) => (dir === 1 ? (i + shift) % n : (shift - i - 1 + 2 * n) % n));
      const cost = la.reduce((s, L, i) => s + Math.abs(L - lb[map[i]]), 0);
      all.push({ map, dir, cost });
    }
  const least = Math.min(...all.map((p) => p.cost));
  const ids = a.vertices.map((v) => v.id);
  const tids = b.vertices.map((v) => v.id);
  const agree = (p) =>
    a.symbols.filter((s) => b.symbols.some((t) => kindOf(t) === kindOf(s) && tids.indexOf(t.wallId) === p.map[ids.indexOf(s.wallId)])).length;
  return all.filter((p) => p.cost <= least + 2).sort((p, q) => agree(q) - agree(p) || p.cost - q.cost)[0];
}

const inch = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}"`;
function kindOf(s) {
  return s.type === "fixture" ? s.fixtureType : s.type === "cabinet" ? "vanity" : s.type;
}

/** Prints the comparison; returns the worst wall's difference in inches (null when the walls do not pair). */
export function score(label, built, truth, feetInches) {
  const pair = pairWalls(built, truth);
  console.log(`\n  ${label}: ${built.name}, ${built.vertices.length} walls, ceiling ${feetInches(built.ceilingHeightFeet * 12)}`);
  if (!pair) {
    console.log(`    walls: ${built.vertices.length} against the tape's ${truth.vertices.length} — not the same shape`);
    return null;
  }
  const lb = lengths(built);
  const lt = lengths(truth);
  let worst = 0;
  lb.forEach((L, i) => {
    const T = lt[pair.map[i]];
    worst = Math.max(worst, Math.abs(L - T));
    console.log(`    wall ${i}: ${feetInches(L).padEnd(7)} tape ${feetInches(T).padEnd(7)} ${inch(L - T)}`);
  });
  console.log(`    worst wall ${inch(worst)}`);
  const ids = built.vertices.map((v) => v.id);
  const tids = truth.vertices.map((v) => v.id);
  for (const s of built.symbols) {
    const i = ids.indexOf(s.wallId);
    const mates = truth.symbols.filter((t) => kindOf(t) === kindOf(s));
    const L = lb[i];
    const fromStart = (pair.dir === 1 ? s.t : 1 - s.t) * L;
    let line = `    ${kindOf(s).padEnd(7)} ${feetInches(s.widthFeet * 12).padEnd(6)}${s.depthFeet ? ` x ${feetInches(s.depthFeet * 12)}` : ""} on wall ${i}`;
    if (!mates.length) line += "   (none in the tape)";
    else {
      const m = mates.map((t) => ({ t, j: tids.indexOf(t.wallId) })).sort((p, q) => (p.j === pair.map[i] ? 0 : 1) - (q.j === pair.map[i] ? 0 : 1))[0];
      const sameWall = m.j === pair.map[i];
      const along = sameWall ? ` centre ${inch(fromStart - m.t.t * lt[m.j])} along` : " tape has it on another wall";
      line += `   tape ${feetInches(m.t.widthFeet * 12)}${m.t.depthFeet ? ` x ${feetInches(m.t.depthFeet * 12)}` : ""}:${along}, width ${inch((s.widthFeet - m.t.widthFeet) * 12)}`;
    }
    console.log(line);
  }
  return worst;
}
