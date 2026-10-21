/**
 * The lens's focal length from a photo's EXIF, for the photo route (2026-10-16): the starting value of
 * f over the picture's width, read before the photo is drawn again (lib/photoImage.ts leaves the EXIF
 * behind). Only `FocalLengthIn35mmFilm` is read - a number about the lens. No position, no camera
 * make or model, no time (lib/exifTime.ts reads the time).
 *
 * The 35 mm equivalent is the focal a full-frame camera (36 x 24 mm, a 43.27 mm diagonal) would need
 * for the same view across the diagonal, so f/W = f35 * sqrt(1 + (H/W)^2) / 43.27: the S25 Ultra's
 * 1x camera (23 mm) on its 4:3 picture is 0.664, as the proof fitted it.
 *
 * Null when the file has no such tag (most edited or shared copies; the owner's 10-16 photos), and
 * the lens is then fitted from the photos alone (lib/photoRouteLens.ts).
 */
export function exifFocal35(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null;
    const marker = view.getUint8(at + 1);
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && at + 10 <= view.byteLength && view.getUint32(at + 4) === 0x45786966) {
      return fromTiff(view, at + 10, Math.min(view.byteLength, at + 2 + length));
    }
    at += 2 + length;
  }
  return null;
}

function fromTiff(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(tiff + 2) !== 0x2a) return null;
  /** A tag's SHORT or LONG value in the IFD at [offset], or null. */
  const valueIn = (offset: number, want: number): number | null => {
    const start = tiff + offset;
    if (start + 2 > end) return null;
    const count = u16(start);
    for (let i = 0; i < count; i++) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > end) break;
      if (u16(entry) !== want) continue;
      const type = u16(entry + 2);
      if (type === 3) return u16(entry + 8);
      if (type === 4) return u32(entry + 8);
      return null;
    }
    return null;
  };
  const exifAt = valueIn(u32(tiff + 4), 0x8769);
  if (exifAt === null) return null;
  const f35 = valueIn(exifAt, 0xa405);
  return f35 !== null && f35 >= 10 && f35 <= 300 ? f35 : null;
}

/** f over the picture's width from a 35 mm equivalent focal, for a picture of that shape. */
export function focalOverWidth(f35: number, width: number, height: number): number {
  // The 35 mm equivalent is across the diagonal; the width is the picture's own, landscape or not.
  return (f35 / 43.27) * (Math.hypot(width, height) / width);
}
