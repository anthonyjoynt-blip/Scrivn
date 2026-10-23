/**
 * What the house runner draws for the session to look at (scripts/house/run.mjs): a review sheet per photo (the photo
 * with a grid in its own pixels, the corner candidates, the corners tapped and their numbers, the tapes, and the shape
 * beside it with where the photo was taken from), a contact sheet, zoomed crops, the measured plan, and each side's
 * squared photo with a grid. Only sharp and SVG: nothing here measures anything.
 */
import sharp from "sharp";
import { cornerName, ftin, sideName } from "./words.mjs";

const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
const C = {
  candidate: "#ff9500",
  named: "#39ff14",
  numbered: "#00e5ff",
  unnumbered: "#ff3355",
  proposed: "#ff4dff",
  tape: "#ffe600",
  check: "#c9a0ff",
  grid: "rgba(255,255,255,0.28)",
  gridStrong: "rgba(255,255,255,0.55)",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text on a dark box, kept inside [w] x [h]. */
function label(x, y, text, colour, { size = 14, w = 1e9, h = 1e9, anchor = "start" } = {}) {
  const tw = String(text).length * size * 0.58 + 6;
  const th = size + 4;
  let x0 = anchor === "middle" ? x - tw / 2 : anchor === "end" ? x - tw : x;
  let y0 = y - th + 3;
  x0 = Math.max(0, Math.min(w - tw, x0));
  y0 = Math.max(0, Math.min(h - th, y0));
  return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${tw.toFixed(1)}" height="${th}" rx="3" fill="rgba(0,0,0,0.72)"/><text x="${(x0 + 3).toFixed(1)}" y="${(y0 + th - 5).toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${colour}">${esc(text)}</text>`;
}

/** A grid in the photo's own pixels, every [step], labelled on the top and left edges; drawn at scale [s]. */
function gridSvg(pw, ph, s, { step = 100, from = [0, 0] } = {}) {
  const out = [];
  const W = pw * s;
  const H = ph * s;
  const every = s * step >= 45 ? step : step * 2;
  const x0 = Math.ceil(from[0] / step) * step;
  const y0 = Math.ceil(from[1] / step) * step;
  for (let x = x0; x <= from[0] + pw; x += step) {
    const X = (x - from[0]) * s;
    out.push(`<line x1="${X.toFixed(1)}" y1="0" x2="${X.toFixed(1)}" y2="${H.toFixed(1)}" stroke="${x % (step * 5) === 0 ? C.gridStrong : C.grid}" stroke-width="1"/>`);
    if (x % every === 0) out.push(label(X + 2, 16, x, "#ffffff", { size: 12, w: W, h: H }));
  }
  for (let y = y0; y <= from[1] + ph; y += step) {
    const Y = (y - from[1]) * s;
    out.push(`<line x1="0" y1="${Y.toFixed(1)}" x2="${W.toFixed(1)}" y2="${Y.toFixed(1)}" stroke="${y % (step * 5) === 0 ? C.gridStrong : C.grid}" stroke-width="1"/>`);
    if (y % every === 0 && y > from[1]) out.push(label(2, Y + 14, y, "#ffffff", { size: 12, w: W, h: H }));
  }
  return out.join("");
}

/**
 * The marks on a photo, at scale [s] (and offset [from] for a crop): candidates (orange, lettered, along their edge),
 * corners tapped (green: named by the session; cyan: numbered by Scrivn; red: no number yet), corners Scrivn proposes
 * (pink, dashed), tapes (yellow) and checks (violet).
 */
function marksSvg(m, s, W, H, from = [0, 0]) {
  const P = (x, y) => [(x - from[0]) * s, (y - from[1]) * s];
  // On a crop, only what is in it: a mark outside would be drawn at its edge, where it isn't.
  const inside = (x, y) => {
    const [X, Y] = P(x, y);
    return X >= 0 && Y >= 0 && X <= W && Y <= H;
  };
  if (from[0] !== 0 || from[1] !== 0) {
    m = {
      candidates: (m.candidates ?? []).filter((c) => inside(c.x, c.y)),
      taps: (m.taps ?? []).filter((c) => inside(c.x, c.y)),
      tapes: (m.tapes ?? []).filter((t) => inside(t.a[0], t.a[1]) || inside(t.b[0], t.b[1])),
      checks: (m.checks ?? []).filter((k) => inside(k.a[0], k.a[1]) || inside(k.b[0], k.b[1])),
      points: (m.points ?? []).filter((p) => inside(p.x, p.y)),
    };
  }
  const out = [];
  const size = 15;
  for (const c of m.candidates ?? []) {
    const [x, y] = P(c.x, c.y);
    if (c.top) {
      const [xt, yt] = P(c.top[0], c.top[1]);
      out.push(`<line x1="${xt.toFixed(1)}" y1="${yt.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.candidate}" stroke-width="2" stroke-opacity="0.8"/>`);
    }
    out.push(`<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l -7 13 l 14 0 z" fill="${C.candidate}" stroke="#000" stroke-width="1"/>`);
    // Up to 26 a photo: every other letter a row lower, so close edges' letters don't sit on each other.
    const lower = /^[a-z]$/.test(c.pick) && (c.pick.charCodeAt(0) - 97) % 2 === 1;
    out.push(label(x, y + (lower ? 50 : 31), c.pick, C.candidate, { size, w: W, h: H, anchor: "middle" }));
  }
  for (const t of m.tapes ?? []) {
    const [ax, ay] = P(t.a[0], t.a[1]);
    const [bx, by] = P(t.b[0], t.b[1]);
    out.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${t.colour ?? C.tape}" stroke-width="3"/>`);
    for (const [x, y] of [[ax, ay], [bx, by]]) out.push(`<line x1="${x.toFixed(1)}" y1="${(y - 9).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 9).toFixed(1)}" stroke="${t.colour ?? C.tape}" stroke-width="3"/>`);
    out.push(label((ax + bx) / 2, Math.min(ay, by) - 8, t.text, t.colour ?? C.tape, { size: 13, w: W, h: H, anchor: "middle" }));
  }
  for (const c of m.taps ?? []) {
    const [x, y] = P(c.x, c.y);
    const colour = c.proposed ? C.proposed : c.corner < 0 ? C.unnumbered : c.named ? C.named : C.numbered;
    const dash = c.proposed ? ` stroke-dasharray="5 4"` : "";
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="#000" stroke-width="4"${dash}/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="${colour}" stroke-width="2.5"${dash}/>`);
    out.push(`<line x1="${x.toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="${colour}" stroke-width="1.5"/>`);
    if (c.snapped) {
      const [sx, sy] = P(c.snapped[0], c.snapped[1]);
      out.push(`<line x1="${sx.toFixed(1)}" y1="${(sy - 22).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(sy + 6).toFixed(1)}" stroke="${colour}" stroke-width="2"/>`);
    }
    out.push(label(x, y - 14, c.corner < 0 ? "?" : `${cornerName(c.corner)}${c.proposed ? "?" : ""}`, colour, { size, w: W, h: H, anchor: "middle" }));
  }
  for (const k of m.checks ?? []) {
    const [ax, ay] = P(k.a[0], k.a[1]);
    const [bx, by] = P(k.b[0], k.b[1]);
    out.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${C.check}" stroke-width="3" stroke-dasharray="8 4"/>`);
    out.push(label(Math.max(ax, bx) + 8, (ay + by) / 2, k.text, C.check, { size: 13, w: W, h: H }));
  }
  for (const p of m.points ?? []) {
    const [x, y] = P(p.x, p.y);
    out.push(`<path d="M ${(x - 10).toFixed(1)} ${y.toFixed(1)} L ${(x + 10).toFixed(1)} ${y.toFixed(1)} M ${x.toFixed(1)} ${(y - 10).toFixed(1)} L ${x.toFixed(1)} ${(y + 10).toFixed(1)}" stroke="${p.colour ?? "#ff3355"}" stroke-width="2"/>`);
    if (p.text) out.push(label(x + 12, y - 6, p.text, p.colour ?? "#ff3355", { size: 13, w: W, h: H }));
  }
  return out.join("");
}

/**
 * The shape as a small plan, [w] x [h]: corners numbered, the front (street) at the bottom, the corners [seen] on this
 * photo filled, and where it was taken from when it is known ([camera]: at, and its view as two plan directions).
 */
export function planSvg(outline, w, h, { seen = [], cameras = [], sides = null, advice = [], title = "", shared = [], big = false, map = null } = {}) {
  const n = outline.length;
  if (n < 3) return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#1b1f24"/></svg>`;
  const pts = [...outline, ...cameras.map((c) => ({ x: c.at[0], y: c.at[1] })), ...(map ?? [])];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = big ? 70 : 34;
  const top = title ? 30 : 8;
  const sx = (w - 2 * pad) / Math.max(1, Math.max(...xs) - Math.min(...xs));
  const sy = (h - 2 * pad - top) / Math.max(1, Math.max(...ys) - Math.min(...ys));
  const s = Math.min(sx, sy);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const X = (x) => w / 2 + (x - cx) * s;
  const Y = (y) => top + (h - top) / 2 - (y - cy) * s;
  const out = [`<rect width="100%" height="100%" fill="#1b1f24"/>`];
  if (title) out.push(`<text x="10" y="21" font-family="${FONT}" font-size="${big ? 18 : 14}" font-weight="600" fill="#e8e8e8">${esc(title)}</text>`);
  out.push(`<polygon points="${outline.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}" fill="rgba(120,160,200,0.18)" stroke="#9fb7cc" stroke-width="2"/>`);
  // The map outline as laid on the house (lib/photoRouteMap.ts): red, dashed.
  if (map?.length >= 3) out.push(`<polygon points="${map.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="#ff5a4a" stroke-width="2.5" stroke-dasharray="10 6"/>`);
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    const mx = (X(a.x) + X(b.x)) / 2;
    const my = (Y(a.y) + Y(b.y)) / 2;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (b.y - a.y) / L;
    const ny = -(b.x - a.x) / L;
    const off = big ? 26 : 14;
    if (shared.includes(i)) out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#888" stroke-width="6" stroke-dasharray="4 4"/>`);
    if (advice.includes(i)) out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#ff9500" stroke-width="4"/>`);
    // A size estimated on site the measure disagrees with: dashed magenta over the side, and what was said beside its length.
    const said = sides?.[i]?.estimateCheck;
    if (said?.disagrees) out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#ff3df2" stroke-width="5" stroke-dasharray="12 6"/>`);
    if (sides?.[i]) {
      const sd = sides[i];
      const text = `${sideName(i, n)} ${ftin(sd.lengthFeet)}${sd.taped ? " tape" : sd.plusMinusPct != null ? ` ±${sd.plusMinusPct}%${sd.estimated ? " est." : ""}` : ""}${said ? ` · said ~${ftin(said.feet)}: ${said.disagrees ? "TAPE IT" : "agrees"}` : ""}`;
      out.push(label(mx + nx * off, my - ny * off + 5, text, sd.taped ? "#ffe600" : said?.disagrees ? "#ff3df2" : advice.includes(i) ? "#ff9500" : "#e8e8e8", { size: big ? 15 : 11, w, h, anchor: "middle" }));
    }
  }
  for (const c of cameras) {
    const px = X(c.at[0]);
    const py = Y(c.at[1]);
    if (c.view) {
      const r = big ? 46 : 30;
      const [l, rr] = c.view;
      out.push(`<path d="M ${px} ${py} L ${(px + l[0] * r).toFixed(1)} ${(py - l[1] * r).toFixed(1)} L ${(px + rr[0] * r).toFixed(1)} ${(py - rr[1] * r).toFixed(1)} Z" fill="rgba(255,230,0,0.22)" stroke="#ffe600" stroke-width="1"/>`);
    }
    out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${big ? 6 : 5}" fill="${c.here ? "#ffe600" : "#c8c8c8"}" stroke="#000"/>`);
    if (c.label) out.push(label(px + 7, py - 6, c.label, c.here ? "#ffe600" : "#c8c8c8", { size: big ? 13 : 11, w, h }));
  }
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    const on = seen.includes(i);
    out.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${on ? 6 : 4}" fill="${on ? "#39ff14" : "#9fb7cc"}" stroke="#000"/>`);
    out.push(label(X(p.x) + 6, Y(p.y) - 6, cornerName(i), on ? "#39ff14" : "#ffffff", { size: big ? 15 : 13, w, h }));
  }
  out.push(`<text x="${w / 2}" y="${h - 6}" text-anchor="middle" font-family="${FONT}" font-size="${big ? 15 : 12}" fill="#9a9a9a">street (front) this way ↓</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${out.join("")}</svg>`;
}

const PHOTO_W = 1200;
const PHOTO_H = 900;
const PLAN_W = 420;
const HEAD = 34;

/**
 * One photo's review sheet as a PNG: the photo with its grid and marks on the left, the shape on the right, a line of
 * words at the top. [px]: its pixels as loaded ({ data, width, height, channels }).
 */
export async function photoSheet(px, { title, marks = {}, outline = [], seen = [], cameras = [], notes = [], shared = [] }) {
  const s = Math.min(PHOTO_W / px.width, PHOTO_H / px.height);
  const W = Math.round(px.width * s);
  const H = Math.round(px.height * s);
  const photo = await sharp(px.data, { raw: { width: px.width, height: px.height, channels: px.channels } }).resize(W, H).png().toBuffer();
  const over = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${gridSvg(px.width, px.height, s)}${marksSvg(marks, s, W, H)}</svg>`;
  const planH = Math.max(H, 520);
  const notesH = notes.length ? 22 * notes.length + 10 : 0;
  const totalH = HEAD + Math.max(H, planH) + notesH;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + PLAN_W}" height="${HEAD}"><rect width="100%" height="100%" fill="#101316"/><text x="10" y="23" font-family="${FONT}" font-size="17" font-weight="600" fill="#ffffff">${esc(title)}</text></svg>`;
  const plan = planSvg(outline, PLAN_W, planH, { seen, cameras, title: "The shape", shared });
  const parts = [
    { input: Buffer.from(head), left: 0, top: 0 },
    { input: photo, left: 0, top: HEAD },
    { input: Buffer.from(over), left: 0, top: HEAD },
    { input: Buffer.from(plan), left: W, top: HEAD },
  ];
  if (notesH) {
    const lines = notes.map((t, i) => `<text x="10" y="${20 + i * 22}" font-family="${FONT}" font-size="15" fill="#f0f0f0">${esc(t)}</text>`).join("");
    parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W + PLAN_W}" height="${notesH}"><rect width="100%" height="100%" fill="#101316"/>${lines}</svg>`), left: 0, top: HEAD + Math.max(H, planH) });
  }
  return sharp({ create: { width: W + PLAN_W, height: totalH, channels: 3, background: "#101316" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}

/** All the photos small, numbered, in walk order, with how many corners each has; the shape last. */
export async function contactSheet(items, outline) {
  const TW = 330;
  const TH = 248;
  const COLS = 5;
  const tiles = [];
  for (const it of items) {
    // Each photo fitted in the tile, a tall one (a tape's close-up) as well as a wide one.
    const s = Math.min(TW / it.px.width, TH / it.px.height);
    const tw = Math.round(it.px.width * s);
    const th = Math.round(it.px.height * s);
    const img = await sharp(it.px.data, { raw: { width: it.px.width, height: it.px.height, channels: it.px.channels } }).resize(tw, th).png().toBuffer();
    const over = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">${marksSvg(it.marks ?? {}, s, tw, th)}${label(4, 22, `#${it.n}`, "#ffe600", { size: 18 })}${label(4, th - 4, it.caption, "#ffffff", { size: 11, w: tw, h: th })}</svg>`;
    tiles.push({ img, over, th });
  }
  const rowH = TH + 6;
  const rows = Math.ceil((tiles.length + 1) / COLS);
  const W = COLS * (TW + 6) + 6;
  const H = rows * rowH + 6;
  const parts = [];
  tiles.forEach((t, i) => {
    const left = 6 + (i % COLS) * (TW + 6);
    const top = 6 + Math.floor(i / COLS) * rowH;
    parts.push({ input: t.img, left, top }, { input: Buffer.from(t.over), left, top });
  });
  const i = tiles.length;
  parts.push({ input: Buffer.from(planSvg(outline, TW, rowH - 6, { title: "The shape" })), left: 6 + (i % COLS) * (TW + 6), top: 6 + Math.floor(i / COLS) * rowH });
  return sharp({ create: { width: W, height: H, channels: 3, background: "#101316" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * A crop of a photo round (x, y), [half] pixels each way, blown up to about 900 px, with a grid every 10 px (labelled
 * every 50) in the photo's own pixels, and the marks.
 */
export async function zoomPng(px, x, y, half, marks = {}, size = 900) {
  return zoomRect(px, [x - half, y - half, x + half, y + half], marks, size, size);
}

/** A crop of the rectangle [x0, y0, x1, y1] of a photo, as zoomPng's, fitted in [maxW] x [maxH]. */
export async function zoomRect(px, rect, marks = {}, maxW = 900, maxH = 900) {
  const x0 = Math.max(0, Math.round(rect[0]));
  const y0 = Math.max(0, Math.round(rect[1]));
  const x1 = Math.min(px.width, Math.round(rect[2]));
  const y1 = Math.min(px.height, Math.round(rect[3]));
  const w = x1 - x0;
  const h = y1 - y0;
  const s = Math.min(maxW / w, maxH / h);
  const W = Math.round(w * s);
  const H = Math.round(h * s);
  const img = await sharp(px.data, { raw: { width: px.width, height: px.height, channels: px.channels } }).extract({ left: x0, top: y0, width: w, height: h }).resize(W, H, { kernel: "nearest" }).png().toBuffer();
  const grid = [];
  for (let gx = Math.ceil(x0 / 10) * 10; gx <= x1; gx += 10) {
    const X = (gx - x0) * s;
    grid.push(`<line x1="${X.toFixed(1)}" y1="0" x2="${X.toFixed(1)}" y2="${H}" stroke="${gx % 50 === 0 ? C.gridStrong : C.grid}" stroke-width="1"/>`);
    if (gx % 50 === 0) grid.push(label(X + 2, 16, gx, "#ffffff", { size: 12, w: W, h: H }));
  }
  for (let gy = Math.ceil(y0 / 10) * 10; gy <= y1; gy += 10) {
    const Y = (gy - y0) * s;
    grid.push(`<line x1="0" y1="${Y.toFixed(1)}" x2="${W}" y2="${Y.toFixed(1)}" stroke="${gy % 50 === 0 ? C.gridStrong : C.grid}" stroke-width="1"/>`);
    if (gy % 50 === 0) grid.push(label(2, Y + 14, gy, "#ffffff", { size: 12, w: W, h: H }));
  }
  const over = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${grid.join("")}${marksSvg(marks, s, W, H, [x0, y0])}</svg>`;
  return sharp(img).composite([{ input: Buffer.from(over), left: 0, top: 0 }]).png().toBuffer();
}

/**
 * Every corner tapped on a photo, close up, in one strip: a crop round each tap with a 10 px grid in the photo's
 * pixels, the tap (red) and where Scrivn's snap moves it (green), and its number - the checkpoint for the corners'
 * places. [taps]: { x, y, corner, named, snapped: [x, y] | null, words }.
 */
export async function tapStrip(px, taps, title, { half = 100, marks = {} } = {}) {
  const CROP = 360;
  const crops = [];
  for (const t of taps) {
    const points = [{ x: t.x, y: t.y, colour: "#ff3355" }];
    if (t.snapped) points.push({ x: t.snapped[0], y: t.snapped[1], colour: "#39ff14" });
    const checks = t.line ? [{ a: t.line[0], b: t.line[1], text: "" }] : [];
    const png = await zoomPng(px, t.x, t.y, half, { ...marks, points, checks: [...(marks.checks ?? []), ...checks] }, CROP);
    const meta = await sharp(png).metadata();
    const tag = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${label(meta.width / 2, meta.height - 6, t.words, t.corner < 0 ? C.unnumbered : t.named ? C.named : C.numbered, { size: 15, w: meta.width, h: meta.height, anchor: "middle" })}</svg>`;
    crops.push(await sharp(png).composite([{ input: Buffer.from(tag), left: 0, top: 0 }]).png().toBuffer());
  }
  const COLS = Math.min(5, Math.max(1, crops.length));
  const rows = Math.ceil(crops.length / COLS);
  const W = COLS * (CROP + 6) + 6;
  const H = HEAD + rows * (CROP + 6) + 6;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEAD}"><text x="8" y="23" font-family="${FONT}" font-size="16" font-weight="600" fill="#ffffff">${esc(title)}</text></svg>`;
  const parts = [{ input: Buffer.from(head), left: 0, top: 0 }];
  crops.forEach((c, i) => parts.push({ input: c, left: 6 + (i % COLS) * (CROP + 6), top: HEAD + 6 + Math.floor(i / COLS) * (CROP + 6) }));
  return sharp({ create: { width: W, height: H, channels: 3, background: "#101316" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}

/** Words wrapped to lines of about [n] characters. */
function wrap(text, n) {
  const out = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    if ((line + " " + w).trim().length > n && line) {
      out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

/**
 * The review: each item in doubt a tight crop round where to look (its candidates lettered, the tap red, where the snap
 * puts it green, an edge or a tape's line drawn), headed with its name as a fix names it and the reason under it. A
 * corner's crop runs up its wall from its foot. Eighteen a page. [pixelsOf(n)]: photo n's pixels; [marksOf(n)]: what to draw on it.
 */
export async function reviewPages(items, pixelsOf, marksOf, title) {
  const CW = 250;
  const CH = 380;
  const CAP = 64;
  const PER = 18;
  const COLS = 6;
  const pages = [];
  for (let p0 = 0; p0 < items.length; p0 += PER) {
    const page = items.slice(p0, p0 + PER);
    const tiles = [];
    for (const [i, it] of page.entries()) {
      let img;
      if (it.photo != null && it.x != null) {
        const px = await pixelsOf(it.photo);
        const base = marksOf(it.photo);
        const points = [{ x: it.x, y: it.y, colour: it.proposed ? C.proposed : "#ff3355" }];
        if (it.snapped) points.push({ x: it.snapped[0], y: it.snapped[1], colour: "#39ff14" });
        const extra = [...(it.line ? [{ a: it.line[0], b: it.line[1], text: "" }] : [])];
        const tapes = it.tape ? [{ a: it.tape[0], b: it.tape[1], text: "" }] : [];
        // A corner is judged by its edge above its foot: the crop runs up the wall from it. A tape's end, round it.
        const rect = it.kind === "tape" ? [it.x - 40, it.y - 60, it.x + 40, it.y + 60] : [it.x - 85, it.y - 300, it.x + 85, it.y + 70];
        img = await zoomRect(px, rect, { ...base, taps: [], tapes: [...(base.tapes ?? []), ...tapes], checks: [...(base.checks ?? []), ...extra], points }, CW, CH);
      } else {
        img = await sharp({ create: { width: CW, height: CH, channels: 3, background: "#1b1f24" } }).png().toBuffer();
      }
      const meta = await sharp(img).metadata();
      const w = meta.width;
      const lines = wrap(it.why, 36).slice(0, 3);
      const cap = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CAP}"><rect width="100%" height="100%" fill="#101316"/>${lines.map((l, k) => `<text x="4" y="${16 + k * 17}" font-family="${FONT}" font-size="13" fill="#f0f0f0">${esc(l)}</text>`).join("")}</svg>`;
      const head = label(4, 22, `R${p0 + i + 1} ${it.title}`, it.kind === "mark" ? C.proposed : it.kind === "tape" ? C.tape : "#ffffff", { size: 16, w, h: meta.height });
      const tile = await sharp({ create: { width: CW, height: CH + CAP, channels: 3, background: "#101316" } })
        .composite([{ input: img, left: 0, top: 0 }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${meta.height}">${head}</svg>`), left: 0, top: 0 }, { input: Buffer.from(cap), left: 0, top: CH }])
        .png()
        .toBuffer();
      tiles.push(tile);
    }
    const rows = Math.ceil(tiles.length / COLS);
    const W = COLS * (CW + 6) + 6;
    const H = HEAD + rows * (CH + CAP + 6) + 6;
    const headSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEAD}"><text x="8" y="23" font-family="${FONT}" font-size="16" font-weight="600" fill="#ffffff">${esc(`${title} (${p0 + 1}-${p0 + page.length} of ${items.length})`)}</text></svg>`;
    const parts = [{ input: Buffer.from(headSvg), left: 0, top: 0 }];
    tiles.forEach((t, i) => parts.push({ input: t, left: 6 + (i % COLS) * (CW + 6), top: HEAD + 6 + Math.floor(i / COLS) * (CH + CAP + 6) }));
    pages.push(await sharp({ create: { width: W, height: H, channels: 3, background: "#101316" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer());
  }
  return pages;
}

/** The measured plan, big: each side with its length and ±, taped sides yellow, sides wanting a tape orange, every placed photo. */
export function measuredPlanPng(ring, sides, cameras, advice, title, shared = [], map = null) {
  const svg = planSvg(ring, 1400, 1000, { sides, cameras, advice, title, shared, big: true, map });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * A side's squared photo with a grid in its own pixels (what reads.json is written in) and the side drawn on it: its
 * ends and its ground from the measure (dashed), a foot ruler along the bottom and up the left.
 */
export async function griddedSide(png, frame, lengthFeet, x) {
  const W = frame.width;
  const H = frame.height;
  const M = 0.3048;
  const out = [gridSvg(W, H, 1)];
  const gx0 = x.frameX(frame, 0);
  const gx1 = x.frameX(frame, lengthFeet * M);
  const gy = x.frameY(frame, 0);
  out.push(`<line x1="${gx0}" y1="0" x2="${gx0}" y2="${H}" stroke="#39ff14" stroke-width="2" stroke-dasharray="10 6"/>`);
  out.push(`<line x1="${gx1}" y1="0" x2="${gx1}" y2="${H}" stroke="#39ff14" stroke-width="2" stroke-dasharray="10 6"/>`);
  out.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#39ff14" stroke-width="2" stroke-dasharray="10 6"/>`);
  for (let f = 0; f <= lengthFeet + 0.01; f += 1) {
    const X = x.frameX(frame, f * M);
    out.push(`<line x1="${X}" y1="${gy}" x2="${X}" y2="${gy + (f % 5 === 0 ? 18 : 9)}" stroke="#ffe600" stroke-width="2"/>`);
    if (f % 5 === 0) out.push(label(X, gy + 36, `${f}'`, "#ffe600", { size: 13, w: W, h: H, anchor: "middle" }));
  }
  for (let f = 0; x.frameY(frame, f * M) > 0; f += 1) {
    const Y = x.frameY(frame, f * M);
    out.push(`<line x1="${gx0}" y1="${Y}" x2="${gx0 - (f % 5 === 0 ? 18 : 9)}" y2="${Y}" stroke="#ffe600" stroke-width="2"/>`);
    if (f % 5 === 0 && f > 0) out.push(label(gx0 - 22, Y + 5, `${f}'`, "#ffe600", { size: 13, w: W, h: H, anchor: "end" }));
  }
  const over = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${out.join("")}</svg>`;
  return sharp(png).composite([{ input: Buffer.from(over), left: 0, top: 0 }]).png({ compressionLevel: 9 }).toBuffer();
}
