"use client";

/**
 * The water-drop tag on a wet surface (2026-10-12, lib/moistureTags.ts): "nothing big just a little water drop tag or
 * something on the affected surface" (the owner). One glyph, drawn the same on a 360 spot's stills (as React, by
 * components/sketch/SpotStills.tsx) and in the 3D view (as a plain element the 3D view's label layer moves about,
 * `wetTagElement`). Small, so it marks the damage without covering it; a white edge so it reads on a dark photo as
 * well as on a white wall. Hover or tap it for what is wet: the wall's material and reading, or the floor's area.
 */

import type { CSSProperties } from "react";
import { tagWords, type MoistureTag } from "@/lib/moistureTags";

/** The drop's blue: water, a shade brighter than the navy, so it reads as wet rather than as the app's chrome. */
export const WET_BLUE = "#2a7fd4";
/** The drop on screen, CSS pixels: 18 across, 23 tall. */
const DROP_W = 18;
const DROP_H = 23;
/** What a finger or the pointer can hit round it. */
const HIT = 32;

const DROP_PATH = "M12 2.2C12 2.2 3.4 13.2 3.4 19.1a8.6 8.6 0 0 0 17.2 0C20.6 13.2 12 2.2 12 2.2Z";
const SHINE_PATH = "M7.9 18.6a4.4 4.4 0 0 0 2.6 4.6";

/** The drop, for React. */
export function WetDrop({ width = DROP_W, height = DROP_H }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 30" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={DROP_PATH} fill={WET_BLUE} stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
      <path d={SHINE_PATH} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  );
}

/** The same drop as markup, for the 3D view's label layer. */
function dropMarkup(): string {
  return (
    `<svg width="${DROP_W}" height="${DROP_H}" viewBox="0 0 24 30" aria-hidden="true" style="display:block;overflow:visible">` +
    `<path d="${DROP_PATH}" fill="${WET_BLUE}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="${SHINE_PATH}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="1.7" stroke-linecap="round"/>` +
    `</svg>`
  );
}

const SHADOW = "drop-shadow(0 1px 2px rgba(10, 20, 35, 0.55))";

const HIT_STYLE: CSSProperties = {
  width: HIT,
  height: HIT,
  padding: 0,
  margin: 0,
  border: 0,
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  filter: SHADOW,
  pointerEvents: "auto",
  touchAction: "manipulation",
};

const BUBBLE_STYLE: CSSProperties = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(16, 22, 30, 0.9)",
  color: "#fff",
  borderRadius: 8,
  padding: "5px 9px",
  font: "12px/1.35 var(--font-ui), system-ui, sans-serif",
  whiteSpace: "nowrap",
  textAlign: "left",
  pointerEvents: "none",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
};

/** One tag on a spot's still: at (left, top) on the picture, its words above it (below, near the top of the view). */
export function WetTagPin({
  tag,
  left,
  top,
  open,
  below,
  onToggle,
  onHover,
}: {
  tag: MoistureTag;
  left: string;
  top: string;
  open: boolean;
  below: boolean;
  onToggle: () => void;
  onHover: (on: boolean) => void;
}) {
  const words = tagWords(tag);
  return (
    <button
      type="button"
      aria-label={`${words.title}: ${words.detail}`}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover(false)}
      style={{ ...HIT_STYLE, position: "absolute", left, top, transform: "translate(-50%, -50%)", zIndex: open ? 2 : 1 }}
    >
      <WetDrop />
      {open && (
        <span role="tooltip" style={{ ...BUBBLE_STYLE, ...(below ? { top: HIT + 2 } : { bottom: HIT + 2 }) }}>
          <strong style={{ fontWeight: 600 }}>{words.title}</strong>
          <br />
          {words.detail}
        </span>
      )}
    </button>
  );
}

const cssText = (style: CSSProperties): string =>
  Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${typeof v === "number" && k !== "zIndex" && k !== "opacity" ? `${v}px` : v}`)
    .join(";");

/**
 * The tag as an element of its own, for the 3D view: the label layer places it over its point every frame. Its words
 * show on hover, and a tap keeps them up until the next tap.
 */
export function wetTagElement(tag: MoistureTag): HTMLElement {
  const words = tagWords(tag);
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${words.title}: ${words.detail}`);
  el.style.cssText = cssText(HIT_STYLE);
  el.innerHTML = dropMarkup();
  const bubble = document.createElement("span");
  bubble.setAttribute("role", "tooltip");
  bubble.style.cssText = cssText({ ...BUBBLE_STYLE, bottom: HIT + 2, display: "none" });
  const strong = document.createElement("strong");
  strong.style.fontWeight = "600";
  strong.textContent = words.title;
  bubble.append(strong, document.createElement("br"), document.createTextNode(words.detail));
  el.appendChild(bubble);
  let pinned = false;
  let hovered = false;
  const update = () => {
    bubble.style.display = pinned || hovered ? "block" : "none";
    el.setAttribute("aria-expanded", String(pinned));
  };
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    hovered = true;
    update();
  });
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    hovered = false;
    update();
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    pinned = !pinned;
    update();
  });
  return el;
}
