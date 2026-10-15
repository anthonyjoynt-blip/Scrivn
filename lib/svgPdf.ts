import type { jsPDF } from "jspdf";

/**
 * Scrivn's own exterior drawings onto a PDF page as lines and text, not a picture (2026-10-15, the
 * exterior report). The elevation and the roof plan are drawn once, as SVG, by
 * components/sketch/exteriorDrawings.tsx - what the estimator sees in the editor - and this paints that
 * SVG with jsPDF's own pen, so a report printed at 100% is to scale and its lines stay sharp.
 *
 * Only what those drawings use: <svg viewBox>, <g transform>, <rect> (rounded too), <polygon>,
 * <polyline>, <line>, <circle> and <text>, with fill, stroke, their opacities, a dash, round caps,
 * `vector-effect="non-scaling-stroke"` (a width in the picture's pixels) and text anchored start,
 * middle or end, bold or italic, turned by the group's rotation. Anything else is passed over: an
 * <image> (the side's photo behind the editor's elevation) is never in a document's drawing.
 *
 * Text keeps to what the PDF's standard fonts can draw (`pdfSafe`): "≈" prints as "~" and a prime as
 * an apostrophe, as the drying log's document does with its own words.
 */

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  /** A text element's words. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", prime: "′", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * The markup React wrote for a drawing, as a tree: well-formed, attributes double-quoted, as
 * `renderToStaticMarkup` and a rendered element's `innerHTML` both write it. Comments are dropped.
 */
export function parseSvg(markup: string): SvgNode {
  const root: SvgNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: SvgNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const top = stack[stack.length - 1] as SvgNode;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] ?? "")) !== null) attrs[a[1] as string] = decode(a[2] ?? "");
      const node: SvgNode = { tag: (m[2] as string).toLowerCase(), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5] !== undefined && !m[0].startsWith("<!--")) {
      top.text += decode(m[5]);
    }
  }
  const svg = findSvg(root);
  if (!svg) throw new Error("No drawing in that markup.");
  return svg;
}

function findSvg(n: SvgNode): SvgNode | null {
  if (n.tag === "svg") return n;
  for (const c of n.children) {
    const f = findSvg(c);
    if (f) return f;
  }
  return null;
}

/** The drawing's own frame, in its units (feet for Scrivn's). */
export function svgViewBox(svg: SvgNode): { x: number; y: number; width: number; height: number } {
  const v = (svg.attrs.viewBox ?? svg.attrs.viewbox ?? "0 0 1 1").trim().split(/[\s,]+/).map(Number);
  const [x = 0, y = 0, w = 1, h = 1] = v;
  return { x, y, width: w > 0 ? w : 1, height: h > 0 ? h : 1 };
}

/** Characters the PDF's standard fonts hold: the few the drawings use outside them, swapped for ones that read the same. */
export function pdfSafe(text: string): string {
  return text
    .replace(/≈/g, "~")
    .replace(/[′’‘]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

/** An affine map, SVG's order: x' = a x + c y + e, y' = b x + d y + f. */
type M = [number, number, number, number, number, number];

const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];

function transformOf(attr: string | undefined): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (!attr) return m;
  const re = /(translate|rotate|scale)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(attr)) !== null) {
    const v = (t[2] ?? "").trim().split(/[\s,]+/).map(Number);
    if (t[1] === "translate") m = mul(m, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]);
    else if (t[1] === "scale") m = mul(m, [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]);
    else {
      const r = ((v[0] ?? 0) * Math.PI) / 180;
      const cx = v[1] ?? 0;
      const cy = v[2] ?? 0;
      const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      m = mul(m, mul([1, 0, 0, 1, cx, cy], mul(rot, [1, 0, 0, 1, -cx, -cy])));
    }
  }
  return m;
}

const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function rgb(c: string | undefined): [number, number, number] | null {
  if (!c || c === "none" || c === "transparent") return null;
  const named: Record<string, string> = { black: "#000000", white: "#ffffff" };
  const hex = (named[c.toLowerCase()] ?? c).replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return [0, 1, 2].map((i) => parseInt((hex[i] as string).repeat(2), 16)) as [number, number, number];
  if (/^[0-9a-f]{6}$/i.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return [0, 0, 0];
}

/** Presentation attributes a group hands down to what is in it. */
const INHERITED = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linecap", "font-size", "font-weight", "font-style", "font-family", "text-anchor", "vector-effect", "opacity"];

interface Style {
  [k: string]: string | undefined;
}

export interface PaintOptions {
  /** Points on the page for one pixel of a stroke drawn not to scale (`non-scaling-stroke`). */
  pixel: number;
}

/**
 * Paints [svg] onto [doc]'s current page, its viewBox's top-left at (x, y) points, [scale] points to
 * one of its units: 9 points a foot is 1/8" = 1'-0".
 */
export function paintSvg(doc: jsPDF, svg: SvgNode, x: number, y: number, scale: number, opts: PaintOptions): void {
  const vb = svgViewBox(svg);
  const base: M = [scale, 0, 0, scale, x - vb.x * scale, y - vb.y * scale];
  const style: Style = {};
  for (const k of INHERITED) if (svg.attrs[k] !== undefined) style[k] = svg.attrs[k];
  for (const c of svg.children) paintNode(doc, c, base, style, opts);
  doc.setLineDashPattern([], 0);
  doc.setLineCap("butt");
  setOpacity(doc, 1, 1);
}

function setOpacity(doc: jsPDF, fill: number, stroke: number): void {
  const G = (doc as unknown as { GState: new (p: { opacity: number; "stroke-opacity": number }) => unknown }).GState;
  doc.setGState(new G({ opacity: fill, "stroke-opacity": stroke }));
}

function num(v: string | undefined, d = 0): number {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function paintNode(doc: jsPDF, n: SvgNode, parent: M, inherited: Style, opts: PaintOptions): void {
  const m = n.attrs.transform ? mul(parent, transformOf(n.attrs.transform)) : parent;
  const style: Style = { ...inherited };
  for (const k of INHERITED) if (n.attrs[k] !== undefined) style[k] = n.attrs[k];
  switch (n.tag) {
    case "g":
      for (const c of n.children) paintNode(doc, c, m, style, opts);
      return;
    case "rect": {
      const x = num(n.attrs.x);
      const y = num(n.attrs.y);
      const w = num(n.attrs.width);
      const h = num(n.attrs.height);
      if (!(w > 0 && h > 0)) return;
      const rx = num(n.attrs.rx);
      shape(doc, m, style, opts, rx > 0 ? roundedRect(x, y, w, h, Math.min(rx, w / 2, h / 2)) : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
      return;
    }
    case "polygon":
    case "polyline": {
      const v = (n.attrs.points ?? "").trim().split(/[\s,]+/).map(Number);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) if (Number.isFinite(v[i]) && Number.isFinite(v[i + 1])) pts.push({ x: v[i] as number, y: v[i + 1] as number });
      if (pts.length >= 2) shape(doc, m, style, opts, pts, n.tag === "polygon");
      return;
    }
    case "line":
      shape(doc, m, { ...style, fill: "none" }, opts, [{ x: num(n.attrs.x1), y: num(n.attrs.y1) }, { x: num(n.attrs.x2), y: num(n.attrs.y2) }], false);
      return;
    case "circle": {
      const r = num(n.attrs.r);
      if (!(r > 0)) return;
      const c = { x: num(n.attrs.cx), y: num(n.attrs.cy) };
      const pts = Array.from({ length: 36 }, (_, i) => ({ x: c.x + r * Math.cos((i / 36) * 2 * Math.PI), y: c.y + r * Math.sin((i / 36) * 2 * Math.PI) }));
      shape(doc, m, style, opts, pts, true);
      return;
    }
    case "text":
      text(doc, n, m, style);
      return;
    default:
      return;
  }
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  for (const [cx, cy, start] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = ((start + (k * 90) / 4) * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return out;
}

/** A filled and/or stroked run of points, in the drawing's units through [m]. */
function shape(doc: jsPDF, m: M, s: Style, opts: PaintOptions, pts: { x: number; y: number }[], closed: boolean): void {
  // SVG fills an unclosed polyline too, unless told not to; the drawings always say "none" for a line.
  const fill = rgb(s.fill ?? "#000000");
  const stroke = rgb(s.stroke);
  const opacity = num(s.opacity, 1);
  const fillOpacity = num(s["fill-opacity"], 1) * opacity;
  const strokeOpacity = num(s["stroke-opacity"], 1) * opacity;
  const width = num(s["stroke-width"], 1);
  const drawFill = fill !== null && fillOpacity > 0.001 && pts.length >= 3;
  const drawStroke = stroke !== null && strokeOpacity > 0.001 && width > 0;
  if (!drawFill && !drawStroke) return;
  const nonScaling = s["vector-effect"] === "non-scaling-stroke";
  const k = nonScaling ? opts.pixel : scaleOf(m);
  const page = pts.map((p) => apply(m, p.x, p.y));
  const path = () => {
    doc.moveTo((page[0] as { x: number }).x, (page[0] as { y: number }).y);
    for (let i = 1; i < page.length; i++) doc.lineTo((page[i] as { x: number }).x, (page[i] as { y: number }).y);
    if (closed) doc.close();
  };
  if (drawFill) {
    setOpacity(doc, fillOpacity, 1);
    doc.setFillColor(...(fill as [number, number, number]));
    path();
    doc.fill();
  }
  if (drawStroke) {
    setOpacity(doc, 1, strokeOpacity);
    doc.setDrawColor(...(stroke as [number, number, number]));
    doc.setLineWidth(Math.max(0.1, width * k));
    const dash = (s["stroke-dasharray"] ?? "").trim();
    const parts = dash && dash !== "none" ? dash.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v >= 0) : [];
    doc.setLineDashPattern(parts.length > 0 ? parts.map((v) => v * k) : [], 0);
    doc.setLineCap(s["stroke-linecap"] === "round" ? "round" : "butt");
    path();
    doc.stroke();
    doc.setLineDashPattern([], 0);
  }
  setOpacity(doc, 1, 1);
}

function text(doc: jsPDF, n: SvgNode, m: M, s: Style): void {
  const words = pdfSafe(collectText(n).replace(/\s+/g, " ").trim());
  if (!words) return;
  const fill = rgb(s.fill ?? "#000000");
  if (!fill) return;
  const opacity = num(s["fill-opacity"], 1) * num(s.opacity, 1);
  const size = num(s["font-size"], 1) * scaleOf(m);
  if (!(size > 0.5)) return;
  const bold = /^(bold|[6-9]00)$/.test(s["font-weight"] ?? "");
  const italic = s["font-style"] === "italic";
  doc.setFont("helvetica", bold ? (italic ? "bolditalic" : "bold") : italic ? "italic" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...fill);
  const at = apply(m, num(n.attrs.x), num(n.attrs.y));
  // The baseline's direction on the page, from the group's turn: text anchored middle or end slides back along it.
  const dir = { x: m[0], y: m[1] };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const w = doc.getTextWidth(words);
  const anchor = s["text-anchor"];
  const back = anchor === "middle" ? w / 2 : anchor === "end" ? w : 0;
  const angle = (-Math.atan2(uy, ux) * 180) / Math.PI;
  setOpacity(doc, opacity, 1);
  doc.text(words, at.x - ux * back, at.y - uy * back, Math.abs(angle) > 0.01 ? { angle } : undefined);
  setOpacity(doc, 1, 1);
}

function collectText(n: SvgNode): string {
  return n.text + n.children.map(collectText).join("");
}
