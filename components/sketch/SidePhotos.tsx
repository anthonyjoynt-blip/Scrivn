"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { formatFeetInches } from "@/lib/sketch";
import { CLADDING_KINDS, CLADDING_LABEL, type ExteriorOpeningKind, type ExteriorShape, type ExteriorSide, formatOpeningSize, OPENING_LABEL, type RoofRise, type SidePhoto } from "@/lib/exterior";
import { fillOutside, type PhotoPixels, squareFrame, type SquareFrame, squareUp } from "@/lib/exteriorPhoto";
import { applyTrace, type SideTrace, type TraceProposals, type TraceRequest, type TraceResponse } from "@/lib/exteriorTrace";
import { formatQuantity } from "@/lib/sketchQuantities";
import { ElevationDrawing, type ElevationReach, type ElevationView } from "./exteriorDrawings";

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
  /** How many of the side's photos were found and laid in. */
  used: number;
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
async function squaredPixels(photos: SidePhoto[], frame: SquareFrame): Promise<{ rgba: Uint8ClampedArray; used: number }> {
  const sources: { photo: SidePhoto; pixels: PhotoPixels }[] = [];
  for (const photo of photos) {
    if (!photo.scanId) continue;
    const url = (await photoLinks(photo.scanId))[photo.n];
    if (!url) continue;
    const pixels = await pixelsOf(url);
    // A picture turned on the way would be read in the wrong place: its shape must be its camera's.
    if (Math.abs(pixels.width / pixels.height - photo.camera.width / photo.camera.height) > 0.02) {
      throw new Error(`Photo ${photo.n} is ${pixels.width}x${pixels.height}, not the shape its camera says (${photo.camera.width}x${photo.camera.height}).`);
    }
    sources.push({ photo, pixels });
  }
  if (sources.length === 0) throw new Error("The photo has not reached Scrivn yet: the phone sends it after the scan. Try again in a minute.");
  return { rgba: squareUp(sources, frame), used: sources.length };
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
  const photos = (side.photos ?? []).filter((p) => p.scanId);
  if (photos.length === 0) return null;
  const frame = squareFrame(side, photos);
  if (!frame) return null;
  const key = JSON.stringify({ p: photos.map((p) => [p.scanId, p.n, p.toPhoto]), f: frame });
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
  const key = frame ? JSON.stringify({ p: photos.map((p) => [p.scanId, p.n, p.toPhoto]), f: frame }) : null;
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
  if (photos.every((p) => !p.scanId)) return { state: "file" };
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

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type Picks = { shapes: Record<string, { on: boolean; kind: ExteriorShape["kind"] }>; openings: Record<string, { on: boolean; kind: ExteriorOpeningKind }>; wallTop: boolean };

function allPicked(p: TraceProposals): Picks {
  return {
    shapes: Object.fromEntries(p.shapes.map((s) => [s.key, { on: true, kind: s.kind }])),
    openings: Object.fromEntries(p.openings.map((o) => [o.key, { on: true, kind: o.kind }])),
    wallTop: p.wallTop !== null,
  };
}

/** The trace over the elevation: ticked proposals solid, the rest dashed; what stands in front boxed. */
function traceOverlay(p: TraceProposals, picks: Picks): ReactNode {
  const pts = (poly: { x: number; y: number }[]) => poly.map((q) => `${q.x},${-q.y}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const fs = 0.55;
  return (
    <g pointerEvents="none">
      {p.offWall.map((b, i) => (
        <g key={`off-${i}`}>
          <rect x={b.x0} y={-b.y1} width={b.x1 - b.x0} height={b.y1 - b.y0} fill={IN_FRONT} fillOpacity={0.08} stroke={IN_FRONT} strokeWidth={1.5} strokeDasharray="5 4" {...stroke} />
          <text x={b.x0 + 0.15} y={-b.y1 + fs * 1.1} fontSize={fs} fill={IN_FRONT} fontFamily="system-ui, sans-serif">
            {b.what}
          </text>
        </g>
      ))}
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
      {p.wallTop && <polyline points={pts(p.wallTop.line)} fill="none" stroke="#155e75" strokeWidth={picks.wallTop ? 2.5 : 1} strokeDasharray="8 4" {...stroke} />}
    </g>
  );
}

function reachOf(boxes: (ElevationReach | null)[]): ElevationReach | undefined {
  const b = boxes.filter((x): x is ElevationReach => x !== null);
  if (b.length === 0) return undefined;
  return { minX: Math.min(...b.map((x) => x.minX)), maxX: Math.max(...b.map((x) => x.maxX)), minZ: Math.min(...b.map((x) => x.minZ)), maxZ: Math.max(...b.map((x) => x.maxZ)) };
}

function proposalsReach(p: TraceProposals): ElevationReach | null {
  const xs = [...p.shapes.flatMap((s) => s.polygon.map((q) => q.x)), ...p.openings.flatMap((o) => [o.fromLeftFeet, o.fromLeftFeet + o.widthFeet]), ...(p.wallTop?.line.map((q) => q.x) ?? [])];
  const ys = [...p.shapes.flatMap((s) => s.polygon.map((q) => q.y)), ...p.openings.map((o) => o.sillFeet + o.heightFeet), ...(p.wallTop?.line.map((q) => q.y) ?? [])];
  if (xs.length === 0) return null;
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...ys), maxZ: Math.max(...ys) };
}

export function SideElevation({
  side,
  rise,
  caption,
  readOnly,
  opacity,
  onOpacity,
  trace,
  onTrace,
  onUpdate,
  editor,
}: {
  side: ExteriorSide;
  rise: RoofRise | null;
  caption: ReactNode;
  readOnly: boolean;
  opacity: PhotoOpacity;
  onOpacity: (o: PhotoOpacity) => void;
  trace: SideTrace | undefined;
  onTrace: (t: SideTrace | undefined) => void;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
  /** What is tapped and dragged to edit the side face-on: see ElevationDrawing. */
  editor?: (view: ElevationView) => ReactNode;
}) {
  const photos = side.photos ?? [];
  const photo = useSquaredPhoto(side);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Picks | null>(trace ? allPicked(trace.proposals) : null);
  const [pickedFor, setPickedFor] = useState(trace?.at);
  if (trace?.at !== pickedFor) {
    setPickedFor(trace?.at);
    setPicks(trace ? allPicked(trace.proposals) : null);
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
  const reach = reachOf([photoReach, trace ? proposalsReach(trace.proposals) : null]);

  async function runTrace() {
    if (!squared) return;
    setBusy(true);
    setError(null);
    try {
      const body: TraceRequest = {
        image: await blobBase64(squared.blob),
        frame: squared.frame,
        side: {
          name: side.name,
          lengthM: side.lengthFeet / FEET_PER_METRE,
          bottomLeftM: side.baseLeftFeet / FEET_PER_METRE,
          bottomRightM: side.baseRightFeet / FEET_PER_METRE,
          leftEndInPhoto: photos.some((p) => p.inView?.leftEnd !== false),
          rightEndInPhoto: photos.some((p) => p.inView?.rightEnd !== false),
        },
      };
      const r = await fetch("/api/exterior/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const answer = (await r.json().catch(() => ({}))) as Partial<TraceResponse> & { error?: string };
      if (!r.ok || !answer.proposals) {
        setError(answer.error ?? `The trace did not come back (${r.status}).`);
        return;
      }
      onTrace({ ...(answer as TraceResponse), at: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The trace did not come back.");
    } finally {
      setBusy(false);
    }
  }

  function use() {
    if (!trace || !picks) return;
    const chosen = {
      shapes: trace.proposals.shapes.filter((s) => picks.shapes[s.key]?.on).map((s) => ({ key: s.key, kind: picks.shapes[s.key]?.kind ?? s.kind })),
      openings: trace.proposals.openings.filter((o) => picks.openings[o.key]?.on).map((o) => ({ key: o.key, kind: picks.openings[o.key]?.kind ?? o.kind })),
      wallTop: picks.wallTop,
    };
    onUpdate((s) => applyTrace(s, trace.proposals, chosen));
    onTrace(undefined);
  }

  return (
    <>
      <ElevationDrawing
        side={side}
        rise={rise}
        backdrop={backdrop}
        overlay={trace && picks ? traceOverlay(trace.proposals, picks) : undefined}
        reach={reach}
        seeThrough={showPhoto}
        editor={editor}
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
                  <button type="button" className="btn-secondary" disabled={!squared || busy} onClick={runTrace} title="One Claude call: the side's shapes, openings and wall top, for you to tick">
                    {busy ? "Tracing…" : trace ? "AI trace again" : "AI trace"}
                  </button>
                )}
              </div>
              <p className="field-note">
                {photo.state === "loading" ? "Squaring the photo up… " : ""}
                {photo.state === "error" ? `${photo.message} ` : ""}
                {inViewLine(photos)}
                {busy ? " Tracing takes 10–40 seconds." : ""}
              </p>
              {error && <p className="sketch-length-error">{error}</p>}
            </>
          )}
        </div>
      )}
      {trace && picks && !readOnly && <TracePanel trace={trace} picks={picks} onPicks={setPicks} onUse={use} onDiscard={() => onTrace(undefined)} />}
    </>
  );
}

function TracePanel({ trace, picks, onPicks, onUse, onDiscard }: { trace: SideTrace; picks: Picks; onPicks: (p: Picks) => void; onUse: () => void; onDiscard: () => void }) {
  const p = trace.proposals;
  const sf = (v: number) => `${formatQuantity(v)} SF`;
  const top = p.wallTop;
  const anything = Object.values(picks.shapes).some((s) => s.on) || Object.values(picks.openings).some((o) => o.on) || picks.wallTop;
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
      {p.offWall.length > 0 && <p className="field-note">In front of the wall, not traced (orange): {p.offWall.map((b) => b.what).join("; ")}.</p>}
      {p.notes && <p className="field-note">The trace&apos;s own notes: {p.notes}</p>}
      <p className="field-note">Ticked shapes replace the side&apos;s shapes, and ticked openings its openings; the wall top sets the eaves, and the peak and pitch when it has one.</p>
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
