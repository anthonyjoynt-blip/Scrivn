import { DEHU_COLOR, DEHU_GLYPH, GLYPH_EDGE, MOVER_AIR_COLOR, MOVER_COLOR, MOVER_GLYPH } from "@/lib/equipmentGlyphs";

/**
 * The equipment symbols as SVG (lib/equipmentGlyphs.ts): for the drying calculator's plan and the keys beside it and the
 * equipment panel. The claim sketch draws the same data with Konva (SketchCanvas's DryingEquipment).
 */

/** An air mover at ([x], [y]) blowing [headingDeg] (clockwise from +x on screen), [scale] times the glyph's units. */
export function MoverSvg({ x = 0, y = 0, headingDeg = 0, scale = 1 }: { x?: number; y?: number; headingDeg?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${headingDeg}) scale(${scale})`} aria-hidden="true">
      <path d={MOVER_GLYPH.air} stroke={MOVER_AIR_COLOR} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d={MOVER_GLYPH.mouth} fill={MOVER_COLOR} stroke={GLYPH_EDGE} strokeWidth={1.6} strokeLinejoin="round" />
      <circle r={MOVER_GLYPH.housingR} fill={MOVER_COLOR} stroke={GLYPH_EDGE} strokeWidth={1.6} />
      <path d={MOVER_GLYPH.swirl} stroke={GLYPH_EDGE} strokeWidth={2} strokeLinecap="round" fill="none" />
      <circle r={MOVER_GLYPH.hubR} fill={GLYPH_EDGE} />
    </g>
  );
}

/** A dehumidifier at ([x], [y]), its box turned [headingDeg], its drop upright. */
export function DehuSvg({ x = 0, y = 0, headingDeg = 0, scale = 1 }: { x?: number; y?: number; headingDeg?: number; scale?: number }) {
  const { w, h, rx } = DEHU_GLYPH;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={rx} fill={DEHU_COLOR} stroke={GLYPH_EDGE} strokeWidth={1.6} transform={`rotate(${headingDeg})`} />
      <path d={DEHU_GLYPH.drop} fill={GLYPH_EDGE} />
    </g>
  );
}

/** The two as a key's icons, sized to sit in a line of text. */
export function MoverKeyIcon() {
  return (
    <svg viewBox="-12 -13 42 26" width="26" height="16">
      <MoverSvg />
    </svg>
  );
}

export function DehuKeyIcon() {
  return (
    <svg viewBox="-13 -10 26 20" width="20" height="15">
      <DehuSvg />
    </svg>
  );
}
