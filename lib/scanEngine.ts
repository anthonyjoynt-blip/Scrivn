import { createElement, type ReactElement } from "react";
import { FootprintDrawing, RoofPlanDrawing } from "@/components/sketch/exteriorDrawings";
import { allSides, endsFromPhotos, type Exterior, exteriorQuantities, formatPitch, type SidePhoto } from "./exterior";
import { finishSideFrom, FINISH_FORMAT, readScanFinish, type ScanFinish, sidesToRead, traceRequestFor } from "./exteriorFinish";
import { parseScanExterior, scanExteriorPart } from "./exteriorImport";
import { fillOutside, type PhotoPixels, squareFrame, type SquareFrame, squareUp } from "./exteriorPhoto";
import { exteriorReport, LINE_WORD, type ReportMeta, sectionName } from "./exteriorReport";
import { exteriorReportBytes, type ReportPhotoImage } from "./exteriorReportPdf";
import { snapTrace, type TraceRequest, type TraceResponse } from "./exteriorTrace";
import { camerasAt, grayOf } from "./roofPhotoRead";
import { formatFeetInches } from "./sketch";

/**
 * Scrivn's exterior on the phone (2026-10-15): what Scrivn Scan runs, bundled into the app as one
 * script (scripts/build-scan-engine.mjs writes it into Scan's assets), so the roof the phone shows and
 * the report it shares are Scrivn's own - the same code as scrivn.ca, offline too.
 *
 * Why not a Kotlin port of the roof: lib/roof.ts and the rules round it (lib/exterior.ts) are some
 * 6,000 lines that change every week; a port is a second roof that drifts from the first the day
 * either changes. Why not Scrivn building the roof on the server: with no signal or no account the
 * phone would have none, and every change on Review would wait for the network. Here only the trace
 * call needs the network (`/api/device/exterior/trace`); everything else runs on the phone.
 *
 * Four things the phone asks of it, each pure but for the [EngineHost] it is given - the WebView's
 * canvas on the phone (lib/scanEngineWebView.ts), sharp in the tests:
 *
 *   summary  the exterior as Scrivn reads it, with the phone's Finish: the roof built (typed > photos >
 *            assumed 4/12, as on scrivn.ca), its ends, what is assumed, which sides still want reading,
 *            and the roof plan as a picture for Review;
 *   prepare  one side's photos squared up (lib/exteriorPhoto.ts) and the trace's request for it;
 *   take     the trace's answer set on the squared photo's edges (`snapTrace`) and made that side's
 *            Finish read - the Finish block back with it in;
 *   report   the exterior report (lib/exteriorReport.ts), as PDF bytes.
 */

export interface EngineHost {
  /** Photo [n] of the capture as the phone keeps it: a JPEG, base64. */
  photo(n: number): Promise<string>;
  /** A JPEG, base64, as pixels. */
  decode(jpegBase64: string): Promise<PhotoPixels>;
  /** RGBA pixels as a JPEG, base64. */
  encodeJpeg(rgba: Uint8ClampedArray, width: number, height: number, quality: number): Promise<string>;
  /** A drawing as a PNG data URL, [width] x [height] pixels; null where the host cannot. */
  rasterize?(svg: string, width: number, height: number): Promise<string | null>;
  /** A drawing's SVG markup. */
  svgOf(element: ReactElement): string;
}

/** Which Scrivn made the engine: set when the script is built. */
declare const __SCRIVN_ENGINE__: string | undefined;
export const ENGINE_VERSION: string = typeof __SCRIVN_ENGINE__ === "string" ? __SCRIVN_ENGINE__ : "scrivn (unbuilt)";

/** Scan's exterior file, as text or parsed: the file itself, or a capture carrying it under "exterior". */
export type CaptureInput = string | Record<string, unknown>;

/**
 * The exterior Scrivn reads from Scan's file with the phone's Finish put on it - exactly what an
 * import of the same file into a claim gives (lib/exteriorImport.ts). [scanIndex] names each side's
 * Scan index by the id Scrivn gave it.
 */
export function exteriorOf(capture: CaptureInput, finish: ScanFinish | null): { exterior: Exterior; scanIndex: Record<string, number>; scale: number; captureId: string | null } {
  const body = typeof capture === "string" ? (JSON.parse(capture) as Record<string, unknown>) : capture;
  const part = scanExteriorPart(body);
  if (!part) throw new Error("This is not a Scrivn Scan exterior.");
  const withFinish = finish ? { ...part, finish } : part;
  const read = parseScanExterior(withFinish, { scanId: null });
  if (!read.ok) throw new Error(read.error);
  const scale = typeof part.scale === "number" && part.scale > 0.5 && part.scale < 2 ? part.scale : 1;
  const captureId = typeof part.capture_id === "string" ? part.capture_id : typeof body.capture_id === "string" ? body.capture_id : null;
  return { exterior: read.exterior, scanIndex: read.scanIndex, scale, captureId };
}

/** The Finish block as the phone holds it: Scrivn's own reading of it, or a new one. */
export function finishOf(raw: unknown): ScanFinish {
  return readScanFinish(typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : null) : raw) ?? { format: FINISH_FORMAT };
}

// ---------------------------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------------------------

export interface EngineSummary {
  ok: true;
  engine: string;
  /** The sides close into a footprint: there is a roof to build. */
  closes: boolean;
  reason: string | null;
  /** Each side with photos, by Scan's index, and whether Finish still has to read it. */
  sides: { index: number; name: string; photos: number[]; toRead: boolean; said: string[] }[];
  roof: {
    pitch: number;
    pitchText: string;
    pitchSource: "typed" | "photos" | "sides" | "assumed";
    pitchWords: string;
    squares: string;
    lines: string;
    eave: string;
    rake: string;
    /** Each end of the roof, by the side it stands over: gable or hip, and who said so. */
    ends: { index: number; name: string; kind: "gable" | "hip"; how: "estimator" | "photo" | "assumed" }[];
    /** A part whose pitch is its own. */
    sections: { name: string; pitch: string }[];
  } | null;
  /** Everything assumed, a sentence each. */
  assumed: string[];
  notes: string[];
  /** The roof plan, a PNG data URL, for Review; null with no roof or no way to draw it. */
  plan: string | null;
  /** The footprint, the same, for an exterior with no roof yet. */
  footprint: string | null;
}

const PLAN_PX = 1080;

export async function summary(capture: CaptureInput, finishRaw: unknown, host: EngineHost | null): Promise<EngineSummary> {
  const finish = finishOf(finishRaw);
  const { exterior, scanIndex, scale } = exteriorOf(capture, finish);
  const q = exteriorQuantities(exterior);
  const report = exteriorReport(exterior, { title: "", date: "", madeWith: "" });
  const every = allSides(exterior);
  const indexOf = (id: string) => scanIndex[id] ?? -1;
  const photosOf = (s: (typeof every)[number]) => (s.photos ?? []).map((p) => p.n);
  const want = new Set(sidesToRead(every.map((s) => ({ index: indexOf(s.id), name: s.name, photos: photosOf(s) })), finish, scale).map((s) => s.index));
  const sides = every
    .filter((s) => photosOf(s).length > 0)
    .map((s) => ({ index: indexOf(s.id), name: s.name, photos: photosOf(s), toRead: want.has(indexOf(s.id)), said: finish.sides?.[String(indexOf(s.id))]?.said ?? [] }));
  const r = q.roofing;
  const plan = q.roof;
  let roof: EngineSummary["roof"] = null;
  let planPng: string | null = null;
  let footprintPng: string | null = null;
  const nameOf = (id: string) => every.find((s) => s.id === id)?.name.trim() || "Side";
  if (plan && r && q.footprint.closes) {
    const fromPhotos = endsFromPhotos(exterior);
    roof = {
      pitch: q.pitch.value ?? 4,
      pitchText: formatPitch(q.pitch.value ?? 4),
      pitchSource: q.pitch.source ?? "assumed",
      pitchWords: report?.sources.find((s) => s.startsWith("Pitch:"))?.replace(/^Pitch: /, "").replace(/\.$/, "") ?? formatPitch(q.pitch.value ?? 4),
      squares: r.squares.toFixed(2),
      lines: (Object.keys(plan.totals) as (keyof typeof plan.totals)[]).filter((k) => plan.lines.some((l) => l.kind === k)).map((k) => `${LINE_WORD[k]} ${formatFeetInches(plan.totals[k])}`).join(" · "),
      eave: `${formatFeetInches(r.overhangs.eave.feet)}${r.overhangs.eave.source === "default" ? " (assumed)" : r.overhangs.eave.source === "photos" ? " (from photos)" : r.overhangs.eave.source === "typed" ? " (typed)" : ""}`,
      rake: `${formatFeetInches(r.overhangs.rake.feet)}${r.overhangs.rake.source === "default" ? " (assumed)" : r.overhangs.rake.source === "photos" ? " (from photos)" : r.overhangs.rake.source === "typed" ? " (typed)" : ""}`,
      ends: plan.ends.map((e) => ({ index: indexOf(e.sideId), name: nameOf(e.sideId), kind: e.kind, how: e.sideId in exterior.roof.ends ? "estimator" : fromPhotos.has(e.sideId) ? "photo" : "assumed" })),
      sections: plan.sections.filter((s) => s.key !== "main" && Math.abs(s.pitch - (q.pitch.value ?? s.pitch)) > 1e-6).map((s) => ({ name: sectionName(s, nameOf, exterior), pitch: formatPitch(s.pitch) })),
    };
    if (host?.rasterize) {
      const R = exterior.roof;
      // The plan as the editor's own "shape" mode draws it, each end's Gable or Hip pill on it.
      const markup = host.svgOf(
        createElement(RoofPlanDrawing, {
          plan,
          footprint: q.footprint,
          upper: q.upperFootprint?.closes ? q.upperFootprint.corners : null,
          nameOf,
          slopes: R.slopes ?? null,
          edges: R.edges ?? null,
          ridgeVents: R.ridgeVents ?? [],
          mode: "shape",
          onEnd: () => undefined,
          fontScale: 1.35,
          size: { width: PLAN_PX, height: PLAN_PX },
        }),
      );
      planPng = await rasterizeFitted(host, markup);
    }
  } else if (q.footprint.closes && host?.rasterize) {
    footprintPng = await rasterizeFitted(host, host.svgOf(createElement(FootprintDrawing, { footprint: q.footprint, nameOf, size: { width: PLAN_PX, height: PLAN_PX } })));
  }
  return {
    ok: true,
    engine: ENGINE_VERSION,
    closes: q.footprint.closes,
    reason: q.footprint.closes ? null : q.footprint.reason,
    sides,
    roof,
    assumed: report?.assumed ?? [],
    notes: report?.notes ?? [],
    plan: planPng,
    footprint: footprintPng,
  };
}

/** A drawing whose viewBox sets its shape: drawn [PLAN_PX] across, as tall as that makes it. */
async function rasterizeFitted(host: EngineHost, markup: string): Promise<string | null> {
  const m = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(markup);
  const w = m ? Number(m[3]) : 1;
  const h = m ? Number(m[4]) : 1;
  const height = Math.max(1, Math.round((PLAN_PX * h) / Math.max(w, 1e-9)));
  const sized = markup.replace(/ width="[\d.]+"/, ` width="${PLAN_PX}"`).replace(/ height="[\d.]+"/, ` height="${height}"`);
  return host.rasterize ? host.rasterize(sized, PLAN_PX, height) : null;
}

// ---------------------------------------------------------------------------------------------
// prepare and take: one side's roof read
// ---------------------------------------------------------------------------------------------

/** What `prepare` keeps of a side for `take`: the squared image as Claude will see it, and what it was squared from. */
export interface Squared {
  index: number;
  frame: SquareFrame;
  /** The squared JPEG, base64: what is sent, and what the lines are set on. */
  image: string;
  used: SidePhoto[];
}

/**
 * Side [index]'s photos squared up into the image the trace is asked about, exactly as the editor
 * squares them (lib/exteriorPhoto.ts), and the request for it: the body `/api/device/exterior/trace`
 * takes, the capture's id in it.
 */
export async function prepare(capture: CaptureInput, finishRaw: unknown, index: number, host: EngineHost): Promise<{ request: TraceRequest & { captureId: string | null }; squared: Squared }> {
  const finish = finishOf(finishRaw);
  const { exterior, scanIndex, scale, captureId } = exteriorOf(capture, finish);
  const side = allSides(exterior).find((s) => scanIndex[s.id] === index);
  if (!side) throw new Error(`There is no side ${index + 1}.`);
  const photos = side.photos ?? [];
  if (photos.length === 0) throw new Error(`${side.name} has no photo.`);
  const frame = squareFrame(side, photos);
  if (!frame) throw new Error(`${side.name}'s photos don't show the side.`);
  const sources: { photo: SidePhoto; pixels: PhotoPixels }[] = [];
  for (const photo of photos) {
    const pixels = await host.decode(await host.photo(photo.n));
    // A picture turned on the way would be read in the wrong place: its shape must be its camera's.
    if (Math.abs(pixels.width / pixels.height - photo.camera.width / photo.camera.height) > 0.02) {
      throw new Error(`Photo ${photo.n} is ${pixels.width}x${pixels.height}, not the shape its camera says (${photo.camera.width}x${photo.camera.height}).`);
    }
    sources.push({ photo, pixels });
  }
  const rgba = fillOutside(squareUp(sources, frame));
  const image = await host.encodeJpeg(rgba, frame.width, frame.height, 0.9);
  const used = sources.map((s) => s.photo);
  const request = { ...traceRequestFor(side, frame, used, image, scale), captureId };
  return { request, squared: { index, frame, image, used } };
}

/**
 * The trace's [answer] for side [index] set on the squared photo's own edges and made that side's
 * Finish read; the Finish block comes back with it in. [squared] is what `prepare` made; without it
 * (the engine restarted in between) the lines stay as Claude gave them.
 */
export async function take(capture: CaptureInput, finishRaw: unknown, index: number, answer: TraceResponse, squared: Squared | null, host: EngineHost | null, at: string = new Date().toISOString()): Promise<ScanFinish> {
  const finish = finishOf(finishRaw);
  const { exterior, scanIndex, scale } = exteriorOf(capture, finish);
  const side = allSides(exterior).find((s) => scanIndex[s.id] === index);
  if (!side) throw new Error(`There is no side ${index + 1}.`);
  let proposals = answer.proposals;
  if (squared && host) {
    try {
      const pixels = await host.decode(squared.image);
      proposals = snapTrace(proposals, squared.frame, grayOf(pixels), side.lengthFeet, camerasAt(squared.used));
    } catch {
      // As Claude gave them: the snap is a refinement, never a reason to lose the read.
    }
  }
  const photos = (squared?.used ?? side.photos ?? []).map((p) => p.n);
  const read = finishSideFrom(side, proposals, photos, scale, at, { model: answer.model, costUsd: answer.costUsd });
  return { ...finish, format: FINISH_FORMAT, engine: ENGINE_VERSION, at, sides: { ...(finish.sides ?? {}), [String(index)]: read } };
}

// ---------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------

/** A JPEG's size, read off its frame header: the report lays each photo out by it. */
export function jpegSize(base64: string): { width: number; height: number } | null {
  const bin = typeof atob === "function" ? atob(base64.slice(0, 200_000)) : Buffer.from(base64.slice(0, 200_000), "base64").toString("binary");
  let i = 2;
  while (i + 9 < bin.length) {
    if (bin.charCodeAt(i) !== 0xff) return null;
    const marker = bin.charCodeAt(i + 1);
    const len = (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6), width: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8) };
    }
    i += 2 + len;
  }
  return null;
}

/** The exterior report as PDF bytes, each side's photos read from the phone ([host], when it has them). */
export async function report(capture: CaptureInput, finishRaw: unknown, meta: ReportMeta, host: Pick<EngineHost, "photo" | "svgOf">): Promise<Uint8Array> {
  const finish = finishOf(finishRaw);
  const { exterior } = exteriorOf(capture, finish);
  const made = exteriorReport(exterior, meta);
  if (!made) throw new Error("There is nothing measured to report yet.");
  const photos: Record<number, ReportPhotoImage> = {};
  for (const p of made.photos) {
    try {
      const b64 = await host.photo(p.photo.n);
      const size = jpegSize(b64);
      if (size) photos[p.photo.n] = { dataUrl: `data:image/jpeg;base64,${b64}`, width: size.width, height: size.height };
    } catch {
      // A photo the phone no longer has is named in the report, not printed.
    }
  }
  return exteriorReportBytes({ report: made, svgOf: host.svgOf, photos, footer: meta.madeWith });
}
