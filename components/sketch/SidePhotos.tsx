"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { formatFeetInches } from "@/lib/sketch";
import { CLADDING_KINDS, CLADDING_LABEL, type ExteriorOpeningKind, type ExteriorShape, type ExteriorSide, formatOpeningSize, formatPitch, OPENING_LABEL, type RoofRise, type SidePhoto } from "@/lib/exterior";
import { fillOutside, type PhotoPixels, squareFrame, type SquareFrame, squareUp } from "@/lib/exteriorPhoto";
import { applyTrace, type ProposedDeck, type RoofPicks, roofPicksAtFirst, type ShapePicks, shapePicksAtFirst, type SideTrace, snapTrace, type TraceProposals, type TraceRequest, type TraceResponse, trimPicksAtFirst, withSwatches } from "@/lib/exteriorTrace";
import { type DoorCandidate, doorCandidates, doorLabel, withSizeDoors } from "@/lib/exteriorScale";
import { type CameraAt, camerasAt, grayOf, type ProposedRoof } from "@/lib/roofPhotoRead";
import { LOWER_ROOF_WORDS, PHOTO_PIECE_LABEL, type PhotoPiece, type ProposedPiece, type ProposedStoreys, type ResolvedPhotoPiece, UPPER_SHOWN_WORDS } from "@/lib/roofPhotoShapes";
import { formatQuantity } from "@/lib/sketchQuantities";
import { ElevationDrawing, type ElevationReach, type ElevationView } from "./exteriorDrawings";
import type { DeckPieceDrawn } from "./deckDrawings";
import { setTraceAside, useSideTrace, waitForSignalToTrace } from "@/lib/aiJobs";
import { traceRequestFor } from "@/lib/exteriorFinish";
import { isNetworkFailure, netFetch } from "@/lib/connectivity";
import { claimSidePhotoUrl } from "./exteriorPhotoAccess";

/** A browser's words for a fetch that got no answer — what squaring a photo says with no signal. */
function isNetworkFailureMessage(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

/**
 * A side's elevation with its photo squared up behind it, and the AI trace of that photo
 * (2026-10-12, Scan 0.1.151 - see lib/exteriorPhoto.ts and lib/exteriorTrace.ts).
 *
 * The photo is squared here, in a canvas, from the picture stored with the scan and Scan's
 * `to_photo`; the same JPEG is what the trace route sends to Claude, so what the estimator compares
 * against the elevation is exactly what was traced. A trace is only ever proposals: each shape,
 * opening and the wall top is ticked onto the side, or not, by the estimator.
 */

const FEET_PER_METRE = 1 / 0.3048;
export type PhotoOpacity = "off" | "half" | "full";
const OPACITY: Record<PhotoOpacity, number> = { off: 0, half: 0.5, full: 1 };
const TRACE = "#0891b2";
const IN_FRONT = "#ea580c";

/** Links to a scan's photos, one request a scan a page; each is signed for an hour. */
const links = new Map<string, Promise<Record<number, string>>>();
function photoLinks(scanId: string): Promise<Record<number, string>> {
  let got = links.get(scanId);
  if (!got) {
    got = fetch(`/api/scans/${scanId}/photos`)
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((body: { photos?: { n: number; url: string }[] }) => Object.fromEntries((body.photos ?? []).map((p) => [p.n, p.url])));
    got.catch(() => links.delete(scanId));
    links.set(scanId, got);
  }
  return got;
}

async function pixelsOf(url: string): Promise<PhotoPixels> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read the photo.");
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, channels: 4 };
}

interface Squared {
  frame: SquareFrame;
  url: string;
  blob: Blob;
  /** The side's photos that were found and laid in, in the order the image was made from them: the trace reads the roof through where each phone stood. */
  used: SidePhoto[];
}

/** Squared images by what they were squared from; a side visited again is not squared again. */
const squaredCache = new Map<string, Promise<Squared>>();

async function squareSide(photos: SidePhoto[], frame: SquareFrame): Promise<Squared> {
  const { rgba: clear, used } = await squaredPixels(photos, frame);
  const rgba = fillOutside(clear);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot square the photo up.");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("This browser cannot make the squared photo.");
  return { frame, url: URL.createObjectURL(blob), blob, used };
}

/** A side's photos fetched and squared into [frame]: clear where none of them shows the wall. */
async function squaredPixels(photos: SidePhoto[], frame: SquareFrame): Promise<{ rgba: Uint8ClampedArray; used: SidePhoto[] }> {
  const sources: { photo: SidePhoto; pixels: PhotoPixels }[] = [];
  for (const photo of photos) {
    // A claim's own site photo (the photo route, 2026-10-16), or one sent with a scan.
    const url = photo.claimPhotoId ? await claimSidePhotoUrl(photo) : photo.scanId ? (await photoLinks(photo.scanId))[photo.n] : undefined;
    if (!url) continue;
    const pixels = await pixelsOf(url);
    // A picture turned on the way would be read in the wrong place: its shape must be its camera's.
    if (Math.abs(pixels.width / pixels.height - photo.camera.width / photo.camera.height) > 0.02) {
      throw new Error(`Photo ${photo.n} is ${pixels.width}x${pixels.height}, not the shape its camera says (${photo.camera.width}x${photo.camera.height}).`);
    }
    sources.push({ photo, pixels });
  }
  if (sources.length === 0) {
    throw new Error(
      photos.some((p) => p.claimPhotoId)
        ? "The photo is not on this phone and has not reached Scrivn yet: it is sent from the phone that took it. Try again in a minute."
        : "The photo has not reached Scrivn yet: the phone sends it after the scan. Try again in a minute.",
    );
  }
  return { rgba: squareUp(sources, frame), used: sources.map((s) => s.photo) };
}

/** Squared images for the 3D view, by what they were squared from. */
const wallPhotoCache = new Map<string, Promise<{ frame: SquareFrame; canvas: HTMLCanvasElement }>>();

/**
 * A side's photos squared up for laying on its wall in 3D (Exterior3D.tsx): the same squaring as the
 * elevation's, but left clear where no photo shows the wall, so the wall's own cladding shows there
 * rather than the grey a JPEG needs. Null for a side with no photo the browser can fetch (none, or a
 * file import's, whose photos stayed on the phone, or none that shows the side).
 */
export function squaredWallPhoto(side: ExteriorSide): Promise<{ frame: SquareFrame; canvas: HTMLCanvasElement }> | null {
  const photos = (side.photos ?? []).filter((p) => p.scanId || p.claimPhotoId);
  if (photos.length === 0) return null;
  const frame = squareFrame(side, photos);
  if (!frame) return null;
  const key = JSON.stringify({ p: photos.map((p) => [p.scanId ?? p.claimPhotoId, p.n, p.toPhoto]), f: frame });
  let job = wallPhotoCache.get(key);
  if (!job) {
    job = squaredPixels(photos, frame).then(({ rgba }) => {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot square the photo up.");
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0);
      return { frame, canvas };
    });
    job.catch(() => wallPhotoCache.delete(key));
    wallPhotoCache.set(key, job);
  }
  return job;
}

type PhotoState = { state: "none" } | { state: "file" } | { state: "loading" } | { state: "ready"; squared: Squared } | { state: "error"; message: string };

function useSquaredPhoto(side: ExteriorSide): PhotoState {
  const photos = side.photos ?? [];
  const frame = useMemo(() => (photos.length > 0 ? squareFrame(side, photos) : null), [side, photos]);
  const key = frame ? JSON.stringify({ p: photos.map((p) => [p.scanId ?? p.claimPhotoId, p.n, p.toPhoto]), f: frame }) : null;
  const [state, setState] = useState<PhotoState>({ state: "loading" });
  useEffect(() => {
    if (!key || !frame) return;
    let live = true;
    let job = squaredCache.get(key);
    if (!job) {
      job = squareSide(photos, frame);
      job.catch(() => squaredCache.delete(key));
      squaredCache.set(key, job);
    }
    setState({ state: "loading" });
    job.then(
      (squared) => live && setState({ state: "ready", squared }),
      (err: unknown) => live && setState({ state: "error", message: err instanceof Error ? err.message : "The photo could not be squared up." }),
    );
    return () => {
      live = false;
    };
    // `key` stands for the photos and the frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (photos.length === 0) return { state: "none" };
  if (photos.every((p) => !p.scanId && !p.claimPhotoId)) return { state: "file" };
  if (!frame) return { state: "error", message: "The photo does not show this side." };
  return state;
}

/** What of the side a photo leaves out, as Scan worked it out. */
function inViewLine(photos: SidePhoto[]): string {
  const out = new Set<string>();
  for (const p of photos) {
    if (!p.inView) continue;
    if (!p.inView.leftEnd && !photos.some((q) => q.inView?.leftEnd)) out.add("left end");
    if (!p.inView.rightEnd && !photos.some((q) => q.inView?.rightEnd)) out.add("right end");
    if (!p.inView.top && !photos.some((q) => q.inView?.top)) out.add("top");
  }
  const list = [...out];
  const n = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;
  if (list.length === 0) return `${n} of this side, laid on its wall by the phone.`;
  return `${n} of this side; the ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`} ${list.length === 1 ? "is" : "are"} out of ${photos.length === 1 ? "it" : "them"}.`;
}

/**
 * A trace's roof lines set on the squared photo's own edges (lib/exteriorTrace.ts `snapTrace`): the
 * image Claude was sent, decoded again, and where each of the side's phones stood. Any failure leaves
 * the trace as Claude gave it.
 */
async function snapped(answer: TraceResponse, squared: Squared, lengthFeet: number): Promise<TraceResponse> {
  try {
    const bitmap = await createImageBitmap(squared.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return answer;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const g = grayOf({ data, width, height, channels: 4 });
    // Each shape's and trim's colour off the same picture (2026-10-17): drawing only.
    return { ...answer, proposals: withSwatches(snapTrace(answer.proposals, squared.frame, g, lengthFeet, camerasAt(squared.used)), { data, width, height, channels: 4 }, squared.frame) };
  } catch {
    return answer;
  }
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type Picks = {
  shapes: Record<string, { on: boolean; kind: ExteriorShape["kind"] }>;
  openings: Record<string, { on: boolean; kind: ExteriorOpeningKind }>;
  wallTop: boolean;
  /** The roof's reads (2026-10-15): each that holds together starts ticked, one flagged starts not. */
  roof: RoofPicks;
  /** Doors kept as size checks (2026-10-15, lib/exteriorScale.ts), each with the size it is taken for: an index into its matches. */
  doors: Record<string, { on: boolean; size: number }>;
  /** The roof's shapes (2026-10-15): dormers and turrets, and what stands over the side. */
  roofShapes: ShapePicks;
  /** The trim (2026-10-17): each surround and column by its key, ticked or not. */
  trims: Record<string, boolean>;
  /** The deck in front (2026-10-20): its pieces put on the deck against this side, ticked or not. */
  deck?: boolean;
};

function allPicked(p: TraceProposals, doors: DoorCandidate[]): Picks {
  return {
    shapes: Object.fromEntries(p.shapes.map((s) => [s.key, { on: true, kind: s.kind }])),
    openings: Object.fromEntries(p.openings.map((o) => [o.key, { on: true, kind: o.kind }])),
    wallTop: p.wallTop !== null,
    roof: roofPicksAtFirst(p.roof),
    doors: Object.fromEntries(doors.map((d) => [d.key, { on: true, size: 0 }])),
    roofShapes: shapePicksAtFirst(p),
    trims: Object.fromEntries(trimPicksAtFirst(p).map((k) => [k, true])),
    deck: !!p.deck,
  };
}

/** The deck read off the photo (2026-10-20), in a row: ticked, it goes on the deck against this side. */
function DeckPick({ p, picks, onPicks, canApply }: { p: TraceProposals; picks: Picks; onPicks: (p: Picks) => void; canApply: boolean }) {
  const d = p.deck;
  if (!d) return null;
  const parts = [
    d.railings.length > 0 ? `${d.railings.length} run${d.railings.length === 1 ? "" : "s"} of ${[...new Set(d.railings.map((r) => r.kind))].join(" and ")} railing` : "",
    ...d.stairs.map((s) => `a stair${s.risers ? `, ${s.risers} risers` : ""}`),
    d.posts.length > 0 ? `${d.posts.length} post${d.posts.length === 1 ? "" : "s"}` : "",
    ...d.screens.map((s) => s.kind === "skirting" ? "skirting" : "a privacy screen"),
    d.decking ? `${d.decking} decking` : "",
  ].filter(Boolean);
  return (
    <div className="exterior-rows">
      <div className="exterior-row">
        <input type="checkbox" aria-label="Use the deck in front" checked={(picks.deck ?? false) && canApply} disabled={!canApply} onChange={() => onPicks({ ...picks, deck: !(picks.deck ?? false) })} />
        <span className="exterior-row-label">Deck in front</span>
        <span className="exterior-row-note">{canApply ? parts.join(", ") : "Put the deck in first (the Decks tab or the photos): a square-on photo can't say how far out it is."}</span>
      </div>
    </div>
  );
}

/** The trim proposal an off_wall box was read into (2026-10-17), by its key; undefined for a thing in front of the wall. */
function trimBox(p: TraceProposals, i: number): string | undefined {
  return (p.trims ?? []).find((t) => t.from.includes(i))?.key ?? (p.columns ?? []).find((c) => c.from.includes(i))?.key;
}

/** An off_wall box that is a piece of the deck in front (2026-10-20): listed as the deck, not as a thing in front of the wall. */
const deckBox = (p: TraceProposals, i: number) => !!p.deck?.from.includes(i);

/** An off_wall box that said an opening is a roll-up door (2026-10-19): not a thing in front of the wall either. */
const rollupBox = (p: TraceProposals, i: number) => p.openings.some((o) => o.rollupFrom === i);

const TRIM_INK = "#7c3aed";

/** The trim read off the photo, each ticked or not (2026-10-17): a surround with the opening it goes round, a column. */
function TrimPicks({ p, picks, onPicks }: { p: TraceProposals; picks: Picks; onPicks: (p: Picks) => void }) {
  const trims = p.trims ?? [];
  const columns = p.columns ?? [];
  if (trims.length === 0 && columns.length === 0) return null;
  const row = (key: string, label: string, note: string) => (
    <div className="exterior-row" key={key}>
      <input type="checkbox" aria-label={`Use ${label}`} checked={picks.trims?.[key] ?? false} onChange={() => onPicks({ ...picks, trims: { ...picks.trims, [key]: !(picks.trims?.[key] ?? false) } })} />
      <span className="exterior-row-label">{label}</span>
      <span className="exterior-row-note">{note}</span>
    </div>
  );
  return (
    <div className="exterior-rows">
      {trims.map((t, i) => {
        const at = p.openings.findIndex((o) => o.key === t.openingKey);
        const x = t.trim;
        const sizes = [`${formatFeetInches(x.leftFeet)} / ${formatFeetInches(x.rightFeet)} sides`, x.topFeet > 0 ? `${formatFeetInches(x.topFeet)} head` : "no head", x.bottomFeet > 0 ? `${formatFeetInches(x.bottomFeet)} sill` : "", x.keystone ? "keystone" : ""].filter(Boolean).join(", ");
        return row(t.key, `Surround ${i + 1}`, `round opening ${at + 1} (it goes on with it) · ${sizes}${x.unsure ? ` · ${x.unsure}` : ""}`);
      })}
      {columns.map((c, i) =>
        row(c.key, `${c.column.kind === "column" ? "Column" : "Pilaster"} ${i + 1}`, `${formatOpeningSize(c.column.widthFeet, c.column.heightFeet)}, ${formatFeetInches(c.column.fromLeftFeet)} from the left${c.column.base ? ", base" : ""}${c.column.cap ? ", cap" : ""}${c.column.unsure ? ` · ${c.column.unsure}` : ""}`),
      )}
    </div>
  );
}

/** The trace over the elevation: ticked proposals solid, the rest dashed; what stands in front boxed. */
function traceOverlay(p: TraceProposals, picks: Picks): ReactNode {
  const pts = (poly: { x: number; y: number }[]) => poly.map((q) => `${q.x},${-q.y}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const fs = 0.55;
  return (
    <g pointerEvents="none">
      {p.offWall.map((b, i) => {
        // The trim read off the photo (2026-10-17): its box, solid when ticked.
        const key = trimBox(p, i);
        if (key) {
          const on = picks.trims?.[key] ?? false;
          return <rect key={`trim-${i}`} x={b.x0} y={-b.y1} width={b.x1 - b.x0} height={b.y1 - b.y0} fill="none" stroke={TRIM_INK} strokeWidth={on ? 2 : 1} strokeDasharray={on ? undefined : "4 4"} {...stroke} />;
        }
        if (rollupBox(p, i)) return null;
        return (
          <g key={`off-${i}`}>
            <rect x={b.x0} y={-b.y1} width={b.x1 - b.x0} height={b.y1 - b.y0} fill={IN_FRONT} fillOpacity={0.08} stroke={IN_FRONT} strokeWidth={1.5} strokeDasharray="5 4" {...stroke} />
            <text x={b.x0 + 0.15} y={-b.y1 + fs * 1.1} fontSize={fs} fill={IN_FRONT} fontFamily="system-ui, sans-serif">
              {b.what}
            </text>
          </g>
        );
      })}
      {p.shapes.map((s) => (
        <polygon key={s.key} points={pts(s.polygon)} fill="none" stroke={TRACE} strokeWidth={picks.shapes[s.key]?.on ? 2.2 : 1} strokeDasharray={picks.shapes[s.key]?.on ? undefined : "4 4"} {...stroke} />
      ))}
      {p.openings.map((o) => (
        <rect
          key={o.key}
          x={o.fromLeftFeet}
          y={-(o.sillFeet + o.heightFeet)}
          width={o.widthFeet}
          height={o.heightFeet}
          fill="none"
          stroke={TRACE}
          strokeWidth={picks.openings[o.key]?.on ? 2.2 : 1}
          strokeDasharray={picks.openings[o.key]?.on ? undefined : "4 4"}
          {...stroke}
        />
      ))}
      {/* A door's leaf, the slab that swings: what its size check reads (2026-10-15). */}
      {p.openings.map((o) =>
        o.leaf ? <rect key={`leaf-${o.key}`} x={o.leaf.x0} y={-o.leaf.y1} width={o.leaf.x1 - o.leaf.x0} height={o.leaf.y1 - o.leaf.y0} fill="none" stroke={TRACE} strokeWidth={1} strokeDasharray="2 3" {...stroke} /> : null,
      )}
      {p.wallTop && <polyline points={pts(p.wallTop.line)} fill="none" stroke="#155e75" strokeWidth={picks.wallTop ? 2.5 : 1} strokeDasharray="8 4" {...stroke} />}
      {p.roof && roofOverlay(p.roof)}
      {/* Dormers and turrets as the photo shows them (2026-10-15): not to scale, as they stand back from the wall. */}
      {(p.pieces ?? []).map((q) =>
        q.outline.length > 1 ? (
          <polyline
            key={q.key}
            points={pts(q.outline)}
            fill="none"
            stroke={ROOF_EDGE}
            strokeWidth={picks.roofShapes.pieces[q.key] ? 2.2 : 1}
            strokeDasharray={picks.roofShapes.pieces[q.key] ? undefined : "4 4"}
            {...stroke}
          />
        ) : null,
      )}
    </g>
  );
}

const ROOF_EDGE = "#c2410c";

/** The roof's edge as the trace drew it - where it shows, bigger than the wall, since it stands out from it - and where it ends. */
function roofOverlay(r: ProposedRoof): ReactNode {
  const pts = (poly: { x: number; y: number }[]) => poly.map((q) => `${q.x},${-q.y}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  return (
    <g>
      {[r.lines.rakeLeft, r.lines.rakeRight, r.lines.eave]
        .filter((l) => l.length > 1)
        .map((l, i) => (
          <polyline key={`edge-${i}`} points={pts(l)} fill="none" stroke={ROOF_EDGE} strokeWidth={1.8} strokeDasharray="3 3" {...stroke} />
        ))}
      {[r.lines.leftEnd, r.lines.rightEnd].map((e, i) => (e ? <circle key={`end-${i}`} cx={e.x} cy={-e.y} r={0.35} fill="none" stroke={ROOF_EDGE} strokeWidth={1.8} {...stroke} /> : null))}
    </g>
  );
}

function reachOf(boxes: (ElevationReach | null)[]): ElevationReach | undefined {
  const b = boxes.filter((x): x is ElevationReach => x !== null);
  if (b.length === 0) return undefined;
  return { minX: Math.min(...b.map((x) => x.minX)), maxX: Math.max(...b.map((x) => x.maxX)), minZ: Math.min(...b.map((x) => x.minZ)), maxZ: Math.max(...b.map((x) => x.maxZ)) };
}

function proposalsReach(p: TraceProposals): ElevationReach | null {
  const edge = p.roof ? [...p.roof.lines.rakeLeft, ...p.roof.lines.rakeRight, ...p.roof.lines.eave] : [];
  const xs = [...p.shapes.flatMap((s) => s.polygon.map((q) => q.x)), ...p.openings.flatMap((o) => [o.fromLeftFeet, o.fromLeftFeet + o.widthFeet]), ...(p.wallTop?.line.map((q) => q.x) ?? []), ...edge.map((q) => q.x)];
  const ys = [...p.shapes.flatMap((s) => s.polygon.map((q) => q.y)), ...p.openings.map((o) => o.sillFeet + o.heightFeet), ...(p.wallTop?.line.map((q) => q.y) ?? []), ...edge.map((q) => q.y)];
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...ys), maxZ: Math.max(...ys) };
}

export function SideElevation({
  side,
  rise,
  base = null,
  caption,
  readOnly,
  opacity,
  onOpacity,
  trace,
  onTrace,
  onUpdate,
  editor,
  roofAssumed = false,
  scaleFactor = null,
  pieceOnRoof,
  decks,
  onDeckRead,
  unseen = null,
}: {
  /** A wall no photo faces (2026-10-21, lib/exterior.ts `unseenState`): stamped "Not photographed". */
  unseen?: "unknown" | "said" | "none" | null;
  /** The decks in front of it (2026-10-20, lib/exteriorViews.ts `decksOnSide`): drawn over it. */
  decks?: DeckPieceDrawn[];
  /** A deck read off its photo put on the deck against it (lib/decks.ts `withDeckRead`); absent: no deck to put it on. */
  onDeckRead?: (read: ProposedDeck, cameraAt: CameraAt | null) => void;
  side: ExteriorSide;
  rise: RoofRise | null;
  /** An upper-floor side: what it stands on. */
  base?: RoofRise | null;
  caption: ReactNode;
  readOnly: boolean;
  opacity: PhotoOpacity;
  onOpacity: (o: PhotoOpacity) => void;
  trace: SideTrace | undefined;
  onTrace: (t: SideTrace | undefined) => void;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
  /** What is tapped and dragged to edit the side face-on: see ElevationDrawing. */
  editor?: (view: ElevationView) => ReactNode;
  /** The roof's pitch is the assumed one: a gable it gives says so. */
  roofAssumed?: boolean;
  /** The house's sizes over the phone's own measure (lib/exteriorScale.ts); null for an exterior not scanned, which has no size checks. */
  scaleFactor?: number | null;
  /** A dormer or turret read off this side's photo, on the roof as built (2026-10-15): its numbers, for the trace's rows. */
  pieceOnRoof?: (pp: PhotoPiece) => ResolvedPhotoPiece;
}) {
  const photos = side.photos ?? [];
  const photo = useSquaredPhoto(side);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    A trace made before the house's sizes were taken from something else is in the old sizes (and
    its photo is squared up differently now): set aside, with a word, rather than put on the side.
  */
  const stale = trace?.scaleAt !== undefined && scaleFactor !== null && Math.abs(trace.scaleAt - scaleFactor) > 1e-9;
  const live = stale ? undefined : trace;
  // The doors on it that can check the sizes, read back to the phone's own measure.
  const doors = useMemo(() => (live && scaleFactor !== null ? doorCandidates(live.proposals.openings, live.scaleAt ?? scaleFactor) : []), [live, scaleFactor]);
  const [picks, setPicks] = useState<Picks | null>(live ? allPicked(live.proposals, doors) : null);
  const [pickedFor, setPickedFor] = useState(live?.at);
  if (live?.at !== pickedFor) {
    setPickedFor(live?.at);
    setPicks(live ? allPicked(live.proposals, doors) : null);
  }

  const squared = photo.state === "ready" ? photo.squared : null;
  const f = squared?.frame;
  const showPhoto = squared !== null && opacity !== "off";
  const backdrop =
    showPhoto && f ? (
      <image
        href={squared.url}
        x={f.alongMinM * FEET_PER_METRE}
        y={-f.upMaxM * FEET_PER_METRE}
        width={(f.width / f.ppm) * FEET_PER_METRE}
        height={(f.height / f.ppm) * FEET_PER_METRE}
        preserveAspectRatio="none"
        opacity={OPACITY[opacity]}
      />
    ) : undefined;
  const photoReach: ElevationReach | null =
    showPhoto && f
      ? { minX: f.alongMinM * FEET_PER_METRE, maxX: f.alongMaxM * FEET_PER_METRE, minZ: f.upMinM * FEET_PER_METRE, maxZ: f.upMaxM * FEET_PER_METRE }
      : null;
  const reach = reachOf([photoReach, live ? proposalsReach(live.proposals) : null]);

  /*
    A trace asked for with no signal waits for it (lib/aiJobs.ts, 2026-10-13) and lands here when it
    comes back — now, or the next time this side is on screen.
  */
  const waitingTrace = useSideTrace(side.id, (job) => {
    const result = job.result;
    // Its roof lines set on the photo's edges, when the photo is squared by now; as Claude gave them if not.
    if (result) void (squared ? snapped(result, squared, side.lengthFeet) : Promise.resolve(result)).then((r) => onTrace({ ...r, at: new Date().toISOString(), scaleAt: job.request.scaleAt }));
    else if (job.error) setError(job.error);
  });

  async function runTrace() {
    if (!squared) return;
    setBusy(true);
    setError(null);
    let body: TraceRequest | null = null;
    try {
      // The same request the phone's Finish exterior makes (lib/exteriorFinish.ts).
      body = traceRequestFor(side, squared.frame, squared.used, await blobBase64(squared.blob), scaleFactor);
      const r = await netFetch("/api/exterior/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 330_000 });
      const answer = (await r.json().catch(() => ({}))) as Partial<TraceResponse> & { error?: string };
      if (!r.ok || !answer.proposals) {
        setError(answer.error ?? `The trace did not come back (${r.status}).`);
        return;
      }
      onTrace({ ...(await snapped(answer as TraceResponse, squared, side.lengthFeet)), at: new Date().toISOString(), ...(scaleFactor !== null ? { scaleAt: scaleFactor } : {}) });
    } catch (err) {
      if (body && isNetworkFailure(err)) await waitForSignalToTrace(side.id, body);
      else setError(err instanceof Error ? err.message : "The trace did not come back.");
    } finally {
      setBusy(false);
    }
  }

  function use() {
    if (!live || !picks) return;
    const chosen = {
      shapes: live.proposals.shapes.filter((s) => picks.shapes[s.key]?.on).map((s) => ({ key: s.key, kind: picks.shapes[s.key]?.kind ?? s.kind })),
      openings: live.proposals.openings.filter((o) => picks.openings[o.key]?.on).map((o) => ({ key: o.key, kind: picks.openings[o.key]?.kind ?? o.kind })),
      wallTop: picks.wallTop,
      roof: picks.roof,
      roofShapes: picks.roofShapes,
      trims: Object.entries(picks.trims ?? {})
        .filter(([, on]) => on)
        .map(([k]) => k),
    };
    // Each door ticked, at the size picked for it: a check on the house's sizes, kept on the side.
    const kept = doors.flatMap((d) => {
      const pick = picks.doors[d.key];
      const m = pick?.on ? d.matches[pick.size] : undefined;
      return m ? [{ kind: d.kind, widthFeet: m.size.widthFeet, heightFeet: m.size.heightFeet, phone: d.phone }] : [];
    });
    onUpdate((s) => withSizeDoors(applyTrace(s, live.proposals, chosen), kept));
    // The deck in front (2026-10-20), ticked: on the deck against this side, each piece at the deck's own distance out.
    if (live.proposals.deck && picks.deck && onDeckRead) onDeckRead(live.proposals.deck, camerasAt(photos));
    onTrace(undefined);
  }

  return (
    <>
      <ElevationDrawing
        side={side}
        rise={rise}
        base={base}
        backdrop={backdrop}
        overlay={live && picks ? traceOverlay(live.proposals, picks) : undefined}
        reach={reach}
        seeThrough={showPhoto}
        editor={editor}
        roofAssumed={roofAssumed}
        unseen={unseen}
        {...(decks && decks.length > 0 ? { decks } : {})}
      />
      {caption}
      {photos.length > 0 && (
        <div className="exterior-photo-bar">
          {photo.state === "file" ? (
            <p className="field-note">{photos.length === 1 ? "This side was photographed" : `This side has ${photos.length} photos`} on the phone, but a file brings no photos: send the scan from the phone to see them here.</p>
          ) : (
            <>
              <div className="exterior-photo-controls">
                <div className="option-group" role="group" aria-label="The side's photo behind the elevation">
                  {(["off", "half", "full"] as const).map((o) => (
                    <button key={o} type="button" className={`option-btn${opacity === o ? " selected" : ""}`} aria-pressed={opacity === o} onClick={() => onOpacity(o)} disabled={!squared && o !== "off"}>
                      {o === "off" ? "No photo" : o === "half" ? "Photo faded" : "Photo"}
                    </button>
                  ))}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!squared || busy || waitingTrace.waiting}
                    onClick={runTrace}
                    title="One Claude call: the side's shapes, openings, wall top and roof edge, for you to tick"
                  >
                    {busy || waitingTrace.running ? "Tracing…" : waitingTrace.waiting ? "Waiting for signal…" : trace ? "AI trace again" : "AI trace"}
                  </button>
                )}
                {!readOnly && waitingTrace.waiting && !waitingTrace.running && (
                  <button type="button" className="btn-secondary" onClick={() => void setTraceAside(side.id)}>
                    Don&rsquo;t wait
                  </button>
                )}
              </div>
              <p className="field-note">
                {photo.state === "loading" ? "Squaring the photo up… " : ""}
                {photo.state === "error" ? (isNetworkFailureMessage(photo.message) ? "The photo is on Scrivn's server; it shows here when there is signal. " : `${photo.message} `) : ""}
                {inViewLine(photos)}
                {busy ? " Tracing takes 10–40 seconds." : ""}
                {waitingTrace.waiting && !waitingTrace.running ? " No signal: the trace runs on its own when there is, and shows here." : ""}
              </p>
              {error && <p className="sketch-length-error">{error}</p>}
            </>
          )}
        </div>
      )}
      {stale && !readOnly && (
        <div className="exterior-photo-controls">
          <p className="field-note">This side was traced before the house&rsquo;s sizes were taken from something else, so the trace is in the old sizes: trace it again.</p>
          <button type="button" className="btn-secondary" onClick={() => onTrace(undefined)}>
            Set the trace aside
          </button>
        </div>
      )}
      {live && picks && !readOnly && <TracePanel trace={live} picks={picks} doors={doors} pieceOnRoof={pieceOnRoof} onPicks={setPicks} onUse={use} onDiscard={() => onTrace(undefined)} canDeck={!!onDeckRead} />}
      {!live && <RoofReadLine side={side} readOnly={readOnly} pieceOnRoof={pieceOnRoof} onUpdate={onUpdate} />}
    </>
  );
}

/** The roof as ticked off this side's photo (2026-10-15), with a way to set it aside later. Nothing when none is ticked. */
function RoofReadLine({
  side,
  readOnly,
  pieceOnRoof,
  onUpdate,
}: {
  side: ExteriorSide;
  readOnly: boolean;
  pieceOnRoof?: (pp: PhotoPiece) => ResolvedPhotoPiece;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
}) {
  const r = side.roofRead;
  if (!r) return null;
  const parts = [
    typeof r.pitch === "number" ? `pitch ${formatPitch(r.pitch)}` : null,
    typeof r.rakeOverhangFeet === "number" ? `rake overhang ${formatFeetInches(r.rakeOverhangFeet)}` : null,
    typeof r.eaveOverhangFeet === "number" ? `eave overhang ${formatFeetInches(r.eaveOverhangFeet)}` : null,
    r.over ? OVER_LABEL[r.over] : null,
    // The roof's shapes (2026-10-15): each piece ticked and not made the estimator's own, and what stands over the side.
    ...(r.pieces ?? []).filter((pp) => pp.taken && !pp.typedAs).map((pp) => pieceWords(pp, pieceOnRoof)),
    r.upper ? UPPER_SHOWN_WORDS[r.upper] : null,
    typeof r.floorLineFeet === "number" ? `its floor line ${formatFeetInches(r.floorLineFeet)} up` : null,
    r.lowerRoof ? `the roof up to it ${LOWER_ROOF_WORDS[r.lowerRoof]}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  // Set aside: each read kept as set aside (null), so the gable gives no pitch off its peak either - as unticking it does.
  const setAside = () =>
    onUpdate((s) => {
      const read = s.roofRead;
      if (!read) return s;
      const next = { ...read };
      if (next.pitch !== undefined) next.pitch = null;
      if (next.rakeOverhangFeet !== undefined) next.rakeOverhangFeet = null;
      if (next.eaveOverhangFeet !== undefined) next.eaveOverhangFeet = null;
      if (next.over !== undefined) next.over = null;
      // Its dormers and turrets no longer counted - offered on the roof pane, one tick away - and what stands over the side set aside.
      if (next.pieces) next.pieces = next.pieces.map((pp) => ({ ...pp, taken: false }));
      if (next.upper !== undefined) next.upper = null;
      if (next.floorLineFeet !== undefined) next.floorLineFeet = null;
      if (next.lowerRoof !== undefined) next.lowerRoof = null;
      return { ...s, roofRead: next, pitchMeasured: read.pitch !== undefined ? null : s.pitchMeasured };
    });
  return (
    <div className="exterior-photo-controls">
      <p className="field-note">Read off this side&apos;s photo for the roof: {parts.join(", ")}.</p>
      {!readOnly && (
        <button type="button" className="btn-secondary" onClick={setAside}>
          Set the roof read aside
        </button>
      )}
    </div>
  );
}

const OVER_LABEL = { gable: "a gable end", hip: "a hip end", eave: "an eave along it" } as const;

/** "a gable dormer 6'2" wide, projecting 4'6", 8/12": a piece as the roof has it, else as the photo shows it. */
function pieceWords(pp: PhotoPiece | ProposedPiece["piece"], onRoof?: (pp: PhotoPiece) => ResolvedPhotoPiece): string {
  const r = onRoof ? onRoof({ id: "", taken: true, ...pp }).piece : null;
  const dims: string[] = [];
  if (pp.kind === "roundTurret") dims.push(`${formatFeetInches(r?.diameterFeet ?? pp.seen.widthFeet)} across`);
  else if (pp.kind === "polygonTurret") dims.push(`${pp.sideCount ?? "?"} sides, ${r?.sideFeet != null ? `${formatFeetInches(r.sideFeet)} each` : `${formatFeetInches(pp.seen.widthFeet)} across`}`);
  else {
    dims.push(`${formatFeetInches(r?.widthFeet ?? pp.seen.widthFeet)} wide`);
    if (r?.projectionFeet != null) dims.push(`projecting ${formatFeetInches(r.projectionFeet)}`);
  }
  if (pp.pitch != null) dims.push(formatPitch(pp.pitch));
  return `a ${PHOTO_PIECE_LABEL[pp.kind].toLowerCase()}, ${dims.join(", ")}`;
}

/** The roof's reads off the photo, each with its own tick (2026-10-15, lib/roofPhotoRead.ts). */
function RoofReads({ roof, picks, onPicks }: { roof: ProposedRoof; picks: RoofPicks; onPicks: (p: RoofPicks) => void }) {
  const row = (key: keyof RoofPicks, label: string, note: string) => (
    <div className="exterior-row" key={key}>
      <input type="checkbox" aria-label={`Use the ${label.toLowerCase()} read off the photo`} checked={picks[key] === true} onChange={() => onPicks({ ...picks, [key]: picks[key] !== true })} />
      <span className="exterior-row-label">{label}</span>
      <span className="exterior-row-note">{note}</span>
    </div>
  );
  const ft = (v: number | null) => (v === null ? "–" : formatFeetInches(v));
  const { pitch, rakeOverhang: rake, eaveOverhang: eave } = roof;
  // Claude's own fascia line, a second look - until the lines are set on the photo's edges, where it is parallel by then.
  const fascia = pitch?.fascia && !roof.snapped ? `; the fascia ${pitch.fascia.map((s) => (s === null ? "–" : s.toFixed(1))).join(" and ")}` : "";
  const any = roof.over || pitch || rake || eave;
  return (
    <>
      <h4 className="exterior-subhead">The roof, off the photo</h4>
      {any && (
        <div className="exterior-rows">
          {roof.over && row("over", "Roof over it", OVER_LABEL[roof.over])}
          {pitch && row("pitch", "Pitch", `${formatPitch(pitch.value)} – the slopes read ${pitch.slopes[0].toFixed(1)} and ${pitch.slopes[1].toFixed(1)} on 12${fascia}`)}
          {rake &&
            row(
              "rake",
              "Rake overhang",
              rake.hangFeet !== null
                ? `${formatFeetInches(rake.feet)} – out to the fascia's face, read off both slopes together; the fascia hangs ${Math.round(rake.hangFeet * 12)}" below the soffit`
                : `${formatFeetInches(rake.feet)} – ${ft(rake.perSlope[0])} and ${ft(rake.perSlope[1])} on the two slopes, the fascia taken as level with the soffit`,
            )}
          {eave &&
            row(
              "eave",
              "Eave overhang",
              `${formatFeetInches(eave.feet)} – ${ft(eave.left)} at the left end, ${ft(eave.right)} at the right, ${eave.from === "rake_foot" ? "where the rakes come down" : "at the hip's corners"}`,
            )}
        </div>
      )}
      {roof.checks.map((c) => (
        <p key={c} className="field-note">
          {c}
        </p>
      ))}
      {roof.notes && <p className="field-note">On the roof, the trace says: {roof.notes}</p>}
    </>
  );
}

/**
 * The roof's shapes off the photo (2026-10-15, lib/roofPhotoShapes.ts): each dormer or turret, and what
 * stands over the side, with its own tick. A piece ticked is a roof piece "from photos"; one left
 * unticked is offered on the roof pane. An upper floor is never drawn from a photo: the read is a tick
 * against the one drawn on the plan.
 */
function RoofShapes({
  pieces,
  storeys,
  picks,
  pieceOnRoof,
  onPicks,
}: {
  pieces: ProposedPiece[];
  storeys: ProposedStoreys | null | undefined;
  picks: ShapePicks;
  pieceOnRoof?: (pp: PhotoPiece) => ResolvedPhotoPiece;
  onPicks: (p: ShapePicks) => void;
}) {
  const s = storeys ?? null;
  if (pieces.length === 0 && !s?.upper) return null;
  const row = (key: string, on: boolean, label: string, note: string, flip: () => void) => (
    <div className="exterior-row" key={key}>
      <input type="checkbox" aria-label={`Use the ${label.toLowerCase()} read off the photo`} checked={on} onChange={flip} />
      <span className="exterior-row-label">{label}</span>
      <span className="exterior-row-note">{note}</span>
    </div>
  );
  // Each piece on the roof as built: its numbers, how far back it stands, and what to know of it.
  const resolved = pieces.map((q) => (pieceOnRoof ? pieceOnRoof({ id: q.key, taken: true, ...q.piece }) : null));
  const checks = [...pieces.flatMap((q, i) => [...q.checks, ...(resolved[i]?.checks ?? [])]), ...(s?.checks ?? [])];
  const notes = [...pieces.map((q) => q.notes), s?.notes ?? ""].filter(Boolean);
  return (
    <>
      <h4 className="exterior-subhead">The roof&rsquo;s shapes, off the photo</h4>
      <div className="exterior-rows">
        {pieces.map((q, i) => {
          const back = resolved[i]?.setBackFeet;
          const words = pieceWords(q.piece, pieceOnRoof).replace(/^an? [^,]+, /, "");
          return row(
            q.key,
            picks.pieces[q.key] === true,
            PHOTO_PIECE_LABEL[q.piece.kind],
            `${words}${back != null ? ` – its face ${formatFeetInches(back)} back from the wall` : ""}`,
            () => onPicks({ ...picks, pieces: { ...picks.pieces, [q.key]: picks.pieces[q.key] !== true } }),
          );
        })}
        {s?.upper && row("upper", picks.upper === true, "Upper floor", UPPER_SHOWN_WORDS[s.upper], () => onPicks({ ...picks, upper: picks.upper !== true }))}
        {s?.floorLineFeet != null &&
          row("floor", picks.floorLine === true, "Floor line", `${formatFeetInches(s.floorLineFeet)} up – where a tall side splits into its two storeys`, () => onPicks({ ...picks, floorLine: picks.floorLine !== true }))}
        {s?.lowerRoof && row("lower", picks.lowerRoof === true, "Roof up to it", LOWER_ROOF_WORDS[s.lowerRoof], () => onPicks({ ...picks, lowerRoof: picks.lowerRoof !== true }))}
      </div>
      {checks.map((c) => (
        <p key={c} className="field-note">
          {c}
        </p>
      ))}
      {notes.map((n) => (
        <p key={n} className="field-note">
          On the roof&rsquo;s shapes, the trace says: {n}
        </p>
      ))}
      {s?.upper && s.upper !== "none" && (
        <p className="field-note">An upper floor is never drawn from a photo: ticked, the plan asks for it, and the high-roof charge is taken from it until it is drawn.</p>
      )}
    </>
  );
}

/**
 * The doors on the photo that can check the house's sizes (2026-10-15, lib/exteriorScale.ts): each
 * ticked one is kept on the side at the size picked for it, and Plan & roof compares it with the
 * phone's own measure and any tape.
 */
function SizeChecks({ doors, scaleAt, picks, onPicks }: { doors: DoorCandidate[]; scaleAt: number; picks: Picks["doors"]; onPicks: (p: Picks["doors"]) => void }) {
  // A garage door to the inch; a door's leaf to the tenth, since an inch is 3% of it.
  const size = (d: DoorCandidate) =>
    d.kind === "garage"
      ? formatOpeningSize(d.phone.widthFeet * scaleAt, d.phone.heightFeet * scaleAt)
      : `${(d.phone.widthFeet * scaleAt * 12).toFixed(1)}" × ${(d.phone.heightFeet * scaleAt * 12).toFixed(1)}"`;
  return (
    <>
      <h4 className="exterior-subhead">A check on the sizes</h4>
      <div className="exterior-rows">
        {doors.map((d, i) => {
          const pick = picks[d.key] ?? { on: false, size: 0 };
          const m = d.matches[pick.size] ?? d.matches[0];
          const off = m ? scaleAt / m.factor - 1 : 0;
          return (
            <div className="exterior-row" key={d.key}>
              <input type="checkbox" aria-label={`Keep door ${i + 1} as a check on the sizes`} checked={pick.on} onChange={() => onPicks({ ...picks, [d.key]: { ...pick, on: !pick.on } })} />
              <select aria-label={`Door ${i + 1}: the size it is`} value={pick.size} onChange={(e) => onPicks({ ...picks, [d.key]: { on: true, size: Number(e.target.value) } })}>
                {d.matches.map((mm, k) => (
                  <option key={k} value={k}>
                    {doorLabel(d.kind, mm.size)}
                  </option>
                ))}
              </select>
              <span className="exterior-row-note">
                {d.kind === "garage" ? "the door itself" : "its leaf"} reads {size(d)} as the house is sized now, {Math.abs(off) < 0.0005 ? "the same" : `${(Math.abs(off) * 100).toFixed(1)}% ${off < 0 ? "small" : "large"}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="field-note">
        A door ticked is kept as a check on the house&rsquo;s sizes, at the size picked: Plan &amp; roof says how far it is from the phone&rsquo;s own measure and any tape, and can take
        the sizes from it. A garage door is the better check: a door&rsquo;s leaf is small, and stands back in its frame.
      </p>
    </>
  );
}

function TracePanel({
  trace,
  picks,
  doors,
  pieceOnRoof,
  onPicks,
  onUse,
  onDiscard,
  canDeck = false,
}: {
  /** A deck stands against this side to put a deck read on (2026-10-20). */
  canDeck?: boolean;
  trace: SideTrace;
  picks: Picks;
  doors: DoorCandidate[];
  pieceOnRoof?: (pp: PhotoPiece) => ResolvedPhotoPiece;
  onPicks: (p: Picks) => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const p = trace.proposals;
  const sf = (v: number) => `${formatQuantity(v)} SF`;
  const top = p.wallTop;
  const rs = picks.roofShapes;
  const anything =
    Object.values(picks.shapes).some((s) => s.on) ||
    Object.values(picks.openings).some((o) => o.on) ||
    picks.wallTop ||
    Object.keys(picks.roof).length > 0 ||
    Object.values(picks.doors).some((d) => d.on) ||
    Object.keys(rs.pieces).length > 0 ||
    rs.upper !== undefined ||
    rs.floorLine !== undefined ||
    rs.lowerRoof !== undefined ||
    Object.values(picks.trims ?? {}).some(Boolean) ||
    (!!picks.deck && canDeck && !!p.deck);
  const topLine = top
    ? [
        top.eaveLeftFeet !== null ? `${formatFeetInches(top.eaveLeftFeet)} at the left end` : null,
        top.eaveRightFeet !== null ? `${formatFeetInches(top.eaveRightFeet)} at the right` : null,
        top.peak ? `peak ${formatFeetInches(top.peak.peakFeet)}, ${formatFeetInches(top.peak.atFeet)} from the left` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    <div className="exterior-trace">
      <h4 className="exterior-subhead">AI trace</h4>
      <p className="field-note">
        Traced in {trace.seconds} s for about ${trace.costUsd.toFixed(2)} ({trace.usage.inputTokens.toLocaleString()} tokens in, {trace.usage.outputTokens.toLocaleString()} out). Blue on the
        drawing; tick what to put on this side.
      </p>
      <div className="exterior-rows">
        {p.shapes.map((s, i) => {
          const pick = picks.shapes[s.key] ?? { on: false, kind: s.kind };
          return (
            <div className="exterior-row" key={s.key}>
              <input type="checkbox" aria-label={`Use shape ${i + 1}`} checked={pick.on} onChange={() => onPicks({ ...picks, shapes: { ...picks.shapes, [s.key]: { ...pick, on: !pick.on } } })} />
              <select aria-label={`Shape ${i + 1}: material`} value={pick.kind} onChange={(e) => onPicks({ ...picks, shapes: { ...picks.shapes, [s.key]: { ...pick, kind: e.target.value as typeof pick.kind } } })}>
                {[...CLADDING_KINDS, "parging" as const].map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "parging" ? "Parging" : CLADDING_LABEL[kind]}
                  </option>
                ))}
              </select>
              <span className="exterior-row-note">
                {s.label ? `${s.label} · ` : ""}
                {sf(s.squareFeet)} gross{s.hiddenBy ? ` · partly behind ${s.hiddenBy}` : ""}
              </span>
            </div>
          );
        })}
        {p.openings.map((o, i) => {
          const pick = picks.openings[o.key] ?? { on: false, kind: o.kind };
          return (
            <div className="exterior-row" key={o.key}>
              <input type="checkbox" aria-label={`Use opening ${i + 1}`} checked={pick.on} onChange={() => onPicks({ ...picks, openings: { ...picks.openings, [o.key]: { ...pick, on: !pick.on } } })} />
              <select aria-label={`Opening ${i + 1}: kind`} value={pick.kind} onChange={(e) => onPicks({ ...picks, openings: { ...picks.openings, [o.key]: { ...pick, kind: e.target.value as ExteriorOpeningKind } } })}>
                {(Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((k) => (
                  <option key={k} value={k}>
                    {OPENING_LABEL[k]}
                  </option>
                ))}
              </select>
              <span className="exterior-row-note">
                {formatOpeningSize(o.widthFeet, o.heightFeet)}, {formatFeetInches(o.fromLeftFeet)} from the left, sill {formatFeetInches(o.sillFeet)} · to the {o.measuredTo}
                {o.hiddenBy ? ` · partly behind ${o.hiddenBy}` : ""}
              </span>
            </div>
          );
        })}
        {top && (
          <div className="exterior-row">
            <input type="checkbox" aria-label="Use the wall top" checked={picks.wallTop} onChange={() => onPicks({ ...picks, wallTop: !picks.wallTop })} />
            <span className="exterior-row-label">Wall top</span>
            <span className="exterior-row-note">{topLine || "reaches neither end of the side"}</span>
          </div>
        )}
      </div>
      {p.checks.map((c) => (
        <p key={c} className="field-note">
          {c}
        </p>
      ))}
      <TrimPicks p={p} picks={picks} onPicks={onPicks} />
      <DeckPick p={p} picks={picks} onPicks={onPicks} canApply={canDeck} />
      {p.offWall.some((_, i) => !trimBox(p, i) && !rollupBox(p, i) && !deckBox(p, i)) && (
        <p className="field-note">
          In front of the wall, not traced (orange):{" "}
          {p.offWall
            .filter((_, i) => !trimBox(p, i) && !rollupBox(p, i) && !deckBox(p, i))
            .map((b) => b.what)
            .join("; ")}
          .
        </p>
      )}
      {p.notes && <p className="field-note">The trace&apos;s own notes: {p.notes}</p>}
      {p.roof && <RoofReads roof={p.roof} picks={picks.roof} onPicks={(roof) => onPicks({ ...picks, roof })} />}
      <RoofShapes pieces={p.pieces ?? []} storeys={p.storeys} picks={rs} pieceOnRoof={pieceOnRoof} onPicks={(roofShapes) => onPicks({ ...picks, roofShapes })} />
      {doors.length > 0 && <SizeChecks doors={doors} scaleAt={trace.scaleAt ?? 1} picks={picks.doors} onPicks={(d) => onPicks({ ...picks, doors: d })} />}
      <p className="field-note">
        Ticked shapes replace the side&apos;s shapes, and ticked openings its openings; the wall top sets the eaves, and the peak when it has one. Ticked roof reads fill the roof as &ldquo;from
        photos&rdquo;: anything typed on the roof wins over them, and they win over what is assumed. A dormer or turret ticked is a roof piece from photos; one left unticked is offered on
        the roof pane.
      </p>
      <div className="exterior-photo-controls">
        <button type="button" className="btn-primary" disabled={!anything} onClick={onUse}>
          Put the ticked ones on this side
        </button>
        <button type="button" className="btn-secondary" onClick={onDiscard}>
          Set the trace aside
        </button>
      </div>
    </div>
  );
}
