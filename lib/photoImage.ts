"use client";

/**
 * Making a site photo the size Scrivn keeps it, on the phone (2026-10-14).
 *
 * A phone camera takes 12 to 50 megapixels. Kept like that a claim's photos would be gigabytes, slow
 * to send on one bar and over the bucket's 2 MB limit, so every photo is drawn again here before it
 * is kept: about 2,000 px on its long side (sharp enough to read a moisture meter's screen or a
 * product label at full size), and a thumbnail for the Photos panel.
 *
 * Drawing it again also leaves behind everything the camera wrote into the file — the GPS position
 * among it. Scrivn keeps no location from photos (PRIVACY.md); the canvas is why that is true.
 */

export const PHOTO_MAX_EDGE = 2000;
export const THUMB_MAX_EDGE = 360;
/** For the photo pages of the Initial Site Report: about 100 to 150 KB each — see lib/photoPdf.ts. */
export const PDF_MAX_EDGE = 1200;
export const PDF_QUALITY = 0.55;
/** Under the bucket's 2 MB limit with room to spare. */
const MAX_FULL_BYTES = 1_900_000;

type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

function sizeOf(source: Drawable): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

/** A picture file as something a canvas can draw, the right way up (phones store many sideways, with a note). */
export async function decodeImage(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* an older browser, or a format it will only show in an <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded image keeps its pixels; the link is not needed past decode.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Drawn onto a canvas no larger than `maxEdge` on its long side. Never scaled up. */
export function drawScaled(source: Drawable, maxEdge: number): HTMLCanvasElement {
  const { width, height } = sizeOf(source);
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the photo.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be saved as a JPEG."))), "image/jpeg", quality);
  });
}

export interface PreparedPhoto {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

/**
 * A camera frame or a picked file, as the two JPEGs Scrivn keeps. The full copy is brought under
 * 2 MB by lowering the quality and then, rarely, the size — a very detailed scene at 2,000 px can
 * pass it at the first quality tried.
 */
export async function preparePhoto(source: Blob | Drawable): Promise<PreparedPhoto> {
  const drawable = source instanceof Blob ? await decodeImage(source) : source;
  let edge = PHOTO_MAX_EDGE;
  let canvas = drawScaled(drawable, edge);
  let quality = 0.85;
  let full = await canvasJpeg(canvas, quality);
  while (full.size > MAX_FULL_BYTES && edge > 400) {
    if (quality > 0.55) quality -= 0.1;
    else {
      edge = Math.round(edge * 0.8);
      canvas = drawScaled(drawable, edge);
    }
    full = await canvasJpeg(canvas, quality);
  }
  const thumb = await canvasJpeg(drawScaled(canvas, THUMB_MAX_EDGE), 0.7);
  if (typeof ImageBitmap !== "undefined" && drawable instanceof ImageBitmap) drawable.close();
  return { full, thumb, width: canvas.width, height: canvas.height };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the photo."));
    reader.readAsDataURL(blob);
  });
}

/** A photo as the PDF draws it: 1,200 px at medium quality, as a JPEG data URL jsPDF embeds as it is. */
export async function pdfImage(blob: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const drawable = await decodeImage(blob);
  const canvas = drawScaled(drawable, PDF_MAX_EDGE);
  if (typeof ImageBitmap !== "undefined" && drawable instanceof ImageBitmap) drawable.close();
  return { dataUrl: await blobToDataUrl(await canvasJpeg(canvas, PDF_QUALITY)), width: canvas.width, height: canvas.height };
}
