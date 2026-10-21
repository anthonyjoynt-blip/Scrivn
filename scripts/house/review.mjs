/**
 * The house runner's review (scripts/house/run.mjs): only what needs a look, on one sheet, and every answer in one edit.
 *
 *   check    the corners and tape ends in doubt - no edge where one was put, a snap that moves it far, an edge's top and
 *            foot off one upright, no number, Scrivn numbering a photo on its own, a photo the shape can't place - each a
 *            tight crop with its candidates, on review.png (review-2.png ... past 18). The rest are on contact.png, for one
 *            look to confirm. review.txt lists them, a line each, the way a fix names them.
 *   measure  the corners the measure disagrees with, Scrivn's marks, photos not placed, a tape the others don't agree
 *            with, deck corners crossed weakly, the photo route's own sanity checks: the same sheet.
 *   fix      scrivn/fixes.txt (or the lines given): every confirm and correction at once, into inputs.json.
 *
 * A fix, a line each ("# " starts a comment; a photo by its number on the sheets, 3 or #3):
 *
 *   3 C10 ok                    as it is (it is not shown again)
 *   3 C10 = c                   candidate c on photo 3 is C10 (in place of the C10 there)
 *   3 C10 = 496,1000            put at x,y (exact: from a close-up, not snapped)
 *   3 C10 ~ 1300,1010           tapped at x,y, snapped onto the edge nearest as a finger's tap is (a reading off a sheet)
 *   3 C10 = 490,600 496,1000    its edge, top then foot (exact)
 *   3 ? = 1340,1010             a corner with no name (Scrivn numbers it)
 *   3 C10 -> C9                 renamed
 *   3 C10 drop                  taken out
 *   3 out / 3 in                the photo left out of the measure, or back in
 *   keep 9:C7 15:C3             Scrivn's marks kept (unkeep to take one back)
 *   tape t1 ok                  its ends as they are
 *   tape t1 15 = 497,900 868,900       its ends on photo 15 (exact); "tape t1#2 ..." the second place it is on
 *   tape t2 side C5-C6          a wall's length, that side
 *   deck back 6 corner:0 = 1210,980    a deck's tap (deck by its name, or a word of it)
 */
import { cornerAt, photoOf } from "./folder.mjs";
import { cornerIndex, cornerName } from "./words.mjs";

/** How far a snap may move a tap, px, before the tap was likely not on the corner's edge. */
const SNAP_MOVE_PX = 6;
/** A faint edge, grey levels: the snap took it, but a corner is a clear step. */
const FAINT_EDGE = 6;
/** An edge's top and foot this far off one upright of the levelled photo, px: likely not one edge (the levelling itself is off a few). */
const EDGE_OFF_PX = 8;
/** The measure's bearing to a corner this many sd off the tap: look again. */
const RESIDUAL_SD = 2.5;

/**
 * Before the measure: each corner and tape end in doubt, why, and where to look. [numbered]: the corners as Scrivn numbered
 * them (lib/photoRoute.ts numberCorners), [quick] a corners-only solve, [data] each photo's levelled camera and grey.
 */
export function checkDoubts(x, h, inputs, { candidates, numbered, quick, data, n }) {
  const items = [];
  const left = new Set((inputs.leaveOut ?? []).map((r) => photoOf(h, r)?.n));
  const placed = new Set(quick.cameras.map((c) => c.photo));
  for (const p of h.photos) {
    if (left.has(p.n)) continue;
    const d = data.find((q) => q.id === p.id);
    const mine = (inputs.corners ?? []).filter((c) => photoOf(h, c.photo)?.n === p.n);
    if (!mine.length) continue;
    const named = mine.some((c) => c.corner != null);
    let first = true;
    for (const c of mine) {
      const at = cornerAt(c, candidates[p.n]);
      if (!at) continue;
      const app = numbered.find((q) => q.photo === p.id && Math.abs(q.x - at[0]) < 1e-6 && Math.abs(q.y - at[1]) < 1e-6);
      const k = c.corner != null ? cornerIndex(c.corner, n) : (app?.corner ?? -1);
      const name = k != null && k >= 0 ? cornerName(k) : "?";
      const why = [];
      let line = null;
      let snapped = null;
      if (d?.camera) {
        if (Array.isArray(c.edge)) {
          const [top, foot] = c.edge[0][1] <= c.edge[1][1] ? c.edge : [c.edge[1], c.edge[0]];
          const du = x.toLevel(d.camera, foot[0], foot[1])[0] - x.toLevel(d.camera, top[0], top[1])[0];
          line = [top, foot];
          if (Math.abs(du) > EDGE_OFF_PX) {
            const f = x.fromLevel(d.camera, x.toLevel(d.camera, top[0], top[1])[0], x.toLevel(d.camera, foot[0], foot[1])[1]);
            why.push(`top and foot ${Math.abs(du).toFixed(0)} px off one upright (the foot would be at x ${f ? f[0].toFixed(0) : "?"})`);
          }
        } else if (!c.exact) {
          const s = x.snapToEdge(d.gray, d.camera, at[0], at[1]);
          if (!s.onEdge) why.push("no edge within 14 px: a tap off the corner, or a corner hidden");
          else {
            snapped = [s.x, s.y];
            if (Math.abs(s.x - at[0]) > SNAP_MOVE_PX) why.push(`the snap moves it ${(s.x - at[0]).toFixed(0)} px: onto another edge?`);
            else if (s.strength < FAINT_EDGE) why.push("a faint edge");
          }
        }
      }
      if (k == null || k < 0) why.push("no number: name it");
      if (!placed.has(p.id) && mine.length >= 2) why.push(`its photo is not placed: ${quick.unplaced.find((u) => u.photo === p.id)?.why ?? "?"}`);
      if (!named && mine.length >= 2 && first) why.push("Scrivn numbered this photo with no name given: is it right?");
      first = false;
      if (c.ok && !why.some((w) => /not placed|no number/.test(w))) continue;
      if (why.length) items.push({ photo: p.n, x: at[0], y: at[1], title: `${p.n} ${name}`, why: why.join("; "), line, snapped, kind: "corner" });
    }
  }
  // Each tape's ends: the scale. Shown till confirmed.
  for (const t of inputs.tapes ?? []) {
    if (t.kind !== "line" || t.skip || t.ok) continue;
    (t.on ?? []).forEach((o, i) => {
      const p = photoOf(h, o.photo);
      if (!p || left.has(p.n) || !o.a || !o.b) return;
      const tag = (t.on.length > 1 ? `${t.id}#${i + 1}` : t.id);
      for (const [end, at] of [["a", o.a], ["b", o.b]]) items.push({ photo: p.n, x: at[0], y: at[1], title: `tape ${tag} ${end}`, why: `${t.said}: is this end where the tape's end was?`, tape: [o.a, o.b], kind: "tape" });
    });
  }
  return items;
}

/**
 * After the measure: the corners whose bearing the measure doesn't agree with, Scrivn's marks, photos not placed, tapes the
 * others don't agree with, deck corners crossed weakly, and the photo route's own sanity checks if it has any.
 */
export function measureDoubts(x, h, inputs, { sol, corners, proposals, hold, decks = [] }) {
  const items = [];
  const S = sol.solution;
  const ofPhoto = (id) => h.photos.find((p) => p.id === id);
  S.input.bearings.forEach((b, i) => {
    const m = /^c(\d+)$/.exec(b.point);
    const r = S.residuals[i];
    if (!m || !(Math.abs(r) > RESIDUAL_SD)) return;
    const k = Number(m[1]);
    const c = corners.find((q) => q.photo === b.camera && q.corner === k && !q.proposed);
    const p = ofPhoto(b.camera);
    if (!c || !p) return;
    items.push({ photo: p.n, x: c.x, y: c.y, title: `${p.n} ${cornerName(k)}`, why: `the measure puts it ${Math.abs(r).toFixed(1)} sd off where it is: the wrong corner, or off its edge?`, kind: "corner" });
  });
  for (const q of proposals) {
    const p = ofPhoto(q.photo);
    if (p) items.push({ photo: p.n, x: q.x, y: q.y, title: `mark ${p.n}:${cornerName(q.corner)}`, why: "Scrivn's mark: keep it only if it sits on that corner's own edge", kind: "mark", proposed: true, corner: q.corner });
  }
  for (const u of sol.unplaced) {
    const p = ofPhoto(u.photo);
    const c = corners.find((q) => q.photo === u.photo);
    if (p && c) items.push({ photo: p.n, x: c.x, y: c.y, title: `${p.n} not placed`, why: u.why, kind: "photo" });
  }
  for (const r of hold?.rows ?? []) {
    if (r.errorPct === null || Math.abs(r.errorPct) <= 5) continue;
    const t = (inputs.tapes ?? []).find((q) => q.id === r.id);
    const o = t?.on?.[0];
    const p = o ? photoOf(h, o.photo) : null;
    if (p && o.a) items.push({ photo: p.n, x: o.a[0], y: o.a[1], title: `tape ${r.id}`, why: `the other tapes put it ${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(1)}% off: its ends, or what was taped?`, tape: [o.a, o.b], kind: "tape" });
  }
  for (const d of decks) {
    for (const c of d.placing?.corners ?? []) {
      if (!c.weak) continue;
      const tap = (d.taps ?? []).find((t) => t.point === c.point);
      const p = tap ? ofPhoto(tap.photo) : null;
      if (p) items.push({ photo: p.n, x: tap.x, y: tap.y, title: `deck ${d.name} ${c.point}`, why: c.photos < 2 ? "on one photo only: tap it on a second" : "its photos stood close together: sure across, not in depth", kind: "deck" });
    }
  }
  // The photo route's own sanity checks, where it gives them (session A, 10-20): read as they come, a line each.
  const sanity = sol.sanity ?? sol.checks ?? [];
  for (const s of Array.isArray(sanity) ? sanity : []) {
    const p = s.photo ? ofPhoto(s.photo) : null;
    const c = p ? corners.find((q) => q.photo === p.id && (s.corner === undefined || q.corner === s.corner)) : null;
    items.push({ photo: p?.n ?? null, x: c?.x ?? null, y: c?.y ?? null, title: `check ${s.kind ?? ""}`.trim(), why: s.words ?? s.why ?? JSON.stringify(s), kind: "sanity" });
  }
  return items;
}

/** The review as text: a line each, named as a fix names it. */
export function reviewLines(items) {
  return items.map((it, i) => `R${i + 1}  ${it.title.padEnd(18)} ${it.why}`);
}

// ── Fixes ────────────────────────────────────────────────────────────────────────────────────────

const PT = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const pt = (s) => {
  const m = PT.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** fixes.txt as fixes: { line, kind, ... } each, or { line, error }. */
export function parseFixes(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    // A comment starts "# " (a photo may be written #3, as the sheets show it).
    const line = raw.replace(/(^|\s)#(\s.*)?$/, "").trim();
    if (!line) continue;
    const w = line.split(/\s+/).map((t, i) => (i === 0 || (i === 2 && /^deck$/.test(line.split(/\s+/)[0])) ? t.replace(/^#(\d+)$/, "$1") : t));
    let m;
    if (w[0] === "keep" || w[0] === "unkeep") out.push({ line, kind: w[0], marks: w.slice(1).flatMap((s) => s.split(",")).filter(Boolean) });
    else if (w[0] === "tape") {
      const id = w[1];
      if (w[2] === "ok") out.push({ line, kind: "tape-ok", id });
      else if (w[2] === "side") out.push({ line, kind: "tape-side", id, side: w[3] });
      else if (/^\d+$/.test(w[2] ?? "") && w[3] === "=" && pt(w[4] ?? "") && pt(w[5] ?? "")) out.push({ line, kind: "tape-ends", id, photo: Number(w[2]), a: pt(w[4]), b: pt(w[5]) });
      else out.push({ line, error: "tape: \"tape t1 ok\", \"tape t1 15 = x,y x,y\" or \"tape t2 side C5-C6\"" });
    } else if (w[0] === "deck") {
      // deck <name> <photo> <point> = x,y
      if ((m = /^(\d+)$/.exec(w[2] ?? "")) && w[4] === "=" && pt(w[5] ?? "")) out.push({ line, kind: "deck-tap", deck: w[1], photo: Number(m[1]), point: w[3], at: pt(w[5]) });
      else out.push({ line, error: "deck: \"deck back 6 corner:0 = x,y\"" });
    } else if (/^\d+$/.test(w[0])) {
      const photo = Number(w[0]);
      if (w[1] === "out" || w[1] === "in") out.push({ line, kind: `photo-${w[1]}`, photo });
      else if (w[2] === "ok") out.push({ line, kind: "ok", photo, name: w[1] });
      else if (w[2] === "drop") out.push({ line, kind: "drop", photo, name: w[1] });
      else if (w[2] === "->" && cornerIndex(w[3]) !== null) out.push({ line, kind: "rename", photo, name: w[1], to: w[3] });
      else if (w[2] === "~" && pt(w[3] ?? "")) out.push({ line, kind: "put", photo, name: w[1], at: pt(w[3]), snap: true });
      else if (w[2] === "=") {
        const a = pt(w[3] ?? "");
        const b = pt(w[4] ?? "");
        if (a && b) out.push({ line, kind: "put", photo, name: w[1], edge: [a, b] });
        else if (a) out.push({ line, kind: "put", photo, name: w[1], at: a });
        else if (/^[a-h]$/i.test(w[3] ?? "")) out.push({ line, kind: "put", photo, name: w[1], pick: w[3].toLowerCase() });
        else out.push({ line, error: "after \"=\": a candidate's letter, x,y, or x,y x,y (an edge's top then foot)" });
      } else out.push({ line, error: "not a fix (see the top of scripts/house/review.mjs)" });
    } else out.push({ line, error: "not a fix (see the top of scripts/house/review.mjs)" });
  }
  return out;
}

/**
 * The fixes put into inputs.json. A corner is found by its name on that photo: the one the session named so, else the one
 * Scrivn numbered so at the last check ([numbered]: { photo: n, x, y, corner: "C10" | null } each). Returns the inputs and
 * what each fix did.
 */
export function applyFixes(h, inputs, fixes, { numbered = [], candidates = {} } = {}) {
  const next = structuredClone(inputs);
  next.corners = next.corners ?? [];
  const n = next.shape?.outline?.length ?? 0;
  const said = [];
  const onPhoto = (photo) => next.corners.filter((c) => photoOf(h, c.photo)?.n === photo);
  const find = (photo, name) => {
    const k = cornerIndex(name, n);
    if (k === null) return null;
    const own = onPhoto(photo).find((c) => c.corner != null && cornerIndex(c.corner, n) === k);
    if (own) return own;
    const app = numbered.find((q) => q.photo === photo && q.corner === cornerName(k));
    if (!app) return null;
    return onPhoto(photo).find((c) => {
      const at = cornerAt(c, candidates[photo]);
      return at && Math.abs(at[0] - app.x) < 1e-6 && Math.abs(at[1] - app.y) < 1e-6;
    }) ?? null;
  };
  const place = (c, f) => {
    delete c.x;
    delete c.y;
    delete c.pick;
    delete c.edge;
    delete c.exact;
    if (f.edge) c.edge = f.edge;
    else if (f.at) Object.assign(c, { x: f.at[0], y: f.at[1] }, f.snap ? {} : { exact: true });
    else if (f.pick) c.pick = f.pick;
  };
  for (const f of fixes) {
    if (f.error) {
      said.push(`✗ "${f.line}": ${f.error}`);
      continue;
    }
    if (f.kind === "keep" || f.kind === "unkeep") {
      const list = new Set(Array.isArray(next.keepProposed) ? next.keepProposed : []);
      for (const mk of f.marks) (f.kind === "keep" ? list.add(mk) : list.delete(mk));
      next.keepProposed = [...list];
      said.push(`${f.kind === "keep" ? "kept" : "no longer kept"}: ${f.marks.join(", ")}`);
    } else if (f.kind === "photo-out" || f.kind === "photo-in") {
      const s = new Set((next.leaveOut ?? []).map(Number));
      if (f.kind === "photo-out") s.add(f.photo);
      else s.delete(f.photo);
      next.leaveOut = [...s].sort((a, b) => a - b);
      said.push(`photo #${f.photo} ${f.kind === "photo-out" ? "left out" : "back in"}`);
    } else if (f.kind.startsWith("tape")) {
      const t = (next.tapes ?? []).find((q) => q.id === f.id.split("#")[0]);
      if (!t) {
        said.push(`✗ "${f.line}": no tape ${f.id}`);
        continue;
      }
      if (f.kind === "tape-ok") t.ok = true;
      else if (f.kind === "tape-side") {
        t.kind = "side";
        t.side = f.side;
        delete t.on;
      } else {
        const at = Number(f.id.split("#")[1] ?? 1) - 1;
        t.kind = "line";
        t.on = t.on ?? [];
        t.on[at] = { photo: f.photo, a: f.a, b: f.b };
        t.exact = true;
        delete t.ok;
      }
      said.push(`tape ${f.id}: ${f.kind === "tape-ok" ? "confirmed" : f.kind === "tape-side" ? `on ${f.side}` : `ends on #${f.photo}`}`);
    } else if (f.kind === "deck-tap") {
      const key = f.deck.toLowerCase();
      const d = (next.decks ?? []).find((q) => [q.name, q.id].some((s2) => s2 && (s2.toLowerCase() === key || s2.toLowerCase().split(/[\s-]+/).includes(key))));
      if (!d) {
        said.push(`✗ "${f.line}": no deck ${f.deck}`);
        continue;
      }
      d.taps = (d.taps ?? []).filter((t) => !(t.photo === f.photo && t.point === f.point));
      d.taps.push({ photo: f.photo, point: f.point, x: f.at[0], y: f.at[1] });
      said.push(`deck ${f.deck}: ${f.point} on #${f.photo}`);
    } else if (f.name === "?" && f.kind === "put") {
      const c = { photo: f.photo };
      place(c, f);
      next.corners.push(c);
      said.push(`#${f.photo}: a corner added, unnamed`);
    } else {
      const c = find(f.photo, f.name);
      if (f.kind === "put") {
        if (c) {
          place(c, f);
          c.corner = f.name;
          delete c.ok;
          said.push(`#${f.photo} ${f.name}: moved`);
        } else {
          const nc = { photo: f.photo, corner: f.name };
          place(nc, f);
          next.corners.push(nc);
          said.push(`#${f.photo} ${f.name}: added`);
        }
        continue;
      }
      if (!c) {
        said.push(`✗ "${f.line}": no ${f.name} on photo ${f.photo} (named, or numbered by Scrivn at the last check)`);
        continue;
      }
      if (f.kind === "ok") {
        c.corner = c.corner ?? f.name;
        c.ok = true;
        said.push(`#${f.photo} ${f.name}: confirmed`);
      } else if (f.kind === "drop") {
        next.corners = next.corners.filter((q) => q !== c);
        said.push(`#${f.photo} ${f.name}: taken out`);
      } else if (f.kind === "rename") {
        c.corner = f.to;
        delete c.ok;
        said.push(`#${f.photo} ${f.name} is ${f.to}`);
      }
    }
  }
  return { inputs: next, said };
}

