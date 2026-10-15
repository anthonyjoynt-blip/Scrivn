import { renderToStaticMarkup } from "react-dom/server.browser";
import type { PhotoPixels } from "./exteriorPhoto";
import { type EngineHost, ENGINE_VERSION, prepare, report, type Squared, summary, take } from "./scanEngine";

/**
 * lib/scanEngine.ts inside Scrivn Scan (2026-10-15): the script scripts/build-scan-engine.mjs bundles
 * into Scan's assets, run in an off-screen WebView (Scan's ExteriorEngine.kt). Never part of
 * scrivn.ca: nothing in the app imports it.
 *
 * The phone talks to it through `ScanBridge`, the object Scan puts in the page, and it answers the
 * same way - everything as text, the big pieces (a photo in, a squared photo or the PDF out) in
 * pieces of 256K, since one call across the bridge is no place for megabytes:
 *
 *   phone:  ScrivnExterior.run(id, op)          op: "summary" | "prepare" | "take" | "report"
 *   engine: ScanBridge.input(id)                the call's input, JSON
 *           ScanBridge.photoPart(n, k, small)   photo n's k-th piece of base64 ("" past the end);
 *                                               small: the report's copy, the phone's own size down
 *           ScanBridge.put(id, piece)           the answer, piece by piece
 *           ScanBridge.done(id, error)          "" when it went, else what went wrong
 *
 * The photos are squared and the drawings drawn on a canvas here: the browser's own JPEG and SVG,
 * as the editor on scrivn.ca uses them.
 */

interface Bridge {
  input(id: string): string;
  photoPart(n: number, k: number, small: boolean): string;
  put(id: string, piece: string): void;
  done(id: string, error: string): void;
}

const PIECE = 256 * 1024;

function bridge(): Bridge {
  const b = (globalThis as unknown as { ScanBridge?: Bridge }).ScanBridge;
  if (!b) throw new Error("Scan's bridge is not in the page.");
  return b;
}

function photoOf(n: number, small: boolean): Promise<string> {
  let s = "";
  for (let k = 0; k < 400; k++) {
    const piece = bridge().photoPart(n, k, small);
    if (!piece) break;
    s += piece;
  }
  if (!s) return Promise.reject(new Error(`Photo ${n} is not on the phone.`));
  return Promise.resolve(s);
}

function canvas(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No canvas here.");
  return ctx;
}

async function image(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function host(small: boolean): EngineHost {
  return {
    photo: (n) => photoOf(n, small),
    async decode(b64): Promise<PhotoPixels> {
      const img = await image(`data:image/jpeg;base64,${b64}`);
      const ctx = canvas(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, 0, 0);
      return { data: ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data, width: img.naturalWidth, height: img.naturalHeight, channels: 4 };
    },
    async encodeJpeg(rgba, width, height, quality) {
      const ctx = canvas(width, height);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return ctx.canvas.toDataURL("image/jpeg", quality).replace(/^data:[^,]*,/, "");
    },
    async rasterize(svg, width, height) {
      try {
        const img = await image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        const ctx = canvas(width, height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return ctx.canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    svgOf: (element) => renderToStaticMarkup(element),
  };
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Each side's squared photo between `prepare` and `take`, by Scan's index. */
const kept = new Map<number, Squared>();

async function go(id: string, op: string): Promise<void> {
  const b = bridge();
  try {
    const input = JSON.parse(b.input(id)) as Record<string, unknown>;
    let out: string;
    switch (op) {
      case "summary":
        out = JSON.stringify(await summary(input.capture as string, input.finish ?? null, host(false)));
        break;
      case "prepare": {
        const r = await prepare(input.capture as string, input.finish ?? null, Number(input.index), host(false));
        kept.set(Number(input.index), r.squared);
        out = JSON.stringify(r.request);
        break;
      }
      case "take":
        out = JSON.stringify(await take(input.capture as string, input.finish ?? null, Number(input.index), input.answer as Parameters<typeof take>[3], kept.get(Number(input.index)) ?? null, host(false)));
        break;
      case "report":
        out = base64(await report(input.capture as string, input.finish ?? null, input.meta as Parameters<typeof report>[2], host(true)));
        break;
      default:
        throw new Error(`No such call: ${op}.`);
    }
    for (let i = 0; i < out.length; i += PIECE) b.put(id, out.slice(i, i + PIECE));
    b.done(id, "");
  } catch (err) {
    b.done(id, err instanceof Error ? err.message || "It failed." : String(err));
  }
}

(globalThis as unknown as { ScrivnExterior: unknown }).ScrivnExterior = {
  version: ENGINE_VERSION,
  run(id: string, op: string): void {
    void go(id, op);
  },
};
