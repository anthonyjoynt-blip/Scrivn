/**
 * When a photo from the phone's gallery was TAKEN, read from its EXIF (2026-10-14, stage 3).
 *
 * A file picked from the gallery carries the time it was copied or saved as its "last modified",
 * which on a phone is often the moment it was shared, not the moment on site. The camera writes the
 * real time into the JPEG itself: `DateTimeOriginal`, in the phone's local time, and on newer phones
 * `OffsetTimeOriginal` beside it saying which time zone that was. Nothing else is read — no position,
 * no camera details — and the picture Scrivn keeps is re-drawn without any of it (lib/photoImage.ts).
 *
 * Returns milliseconds, or null when the file has no such time (a screenshot, a PNG, an edited copy).
 */
export function exifTakenAt(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null;
    const marker = view.getUint8(at + 1);
    // Start of scan: the picture itself, and no metadata after it.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && at + 10 <= view.byteLength && ascii(view, at + 4, 4) === "Exif") {
      return fromTiff(view, at + 10, Math.min(view.byteLength, at + 2 + length));
    }
    at += 2 + length;
  }
  return null;
}

function ascii(view: DataView, start: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && start + i < view.byteLength; i++) {
    const c = view.getUint8(start + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function fromTiff(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(tiff + 2) !== 0x2a) return null;

  /** An IFD's ASCII values by tag, and where the next IFDs it points to are. */
  const readIfd = (offset: number): Map<number, string | number> => {
    const out = new Map<number, string | number>();
    const start = tiff + offset;
    if (start + 2 > end) return out;
    const count = u16(start);
    for (let i = 0; i < count; i++) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > end) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      if (type === 2) {
        const valueAt = n <= 4 ? entry + 8 : tiff + u32(entry + 8);
        if (valueAt + n <= end) out.set(tag, ascii(view, valueAt, n));
      } else if (type === 4 || type === 13) {
        out.set(tag, u32(entry + 8));
      }
    }
    return out;
  };

  const ifd0 = readIfd(u32(tiff + 4));
  const exifPointer = ifd0.get(0x8769);
  const exif = typeof exifPointer === "number" ? readIfd(exifPointer) : new Map<number, string | number>();
  const original = exif.get(0x9003) ?? exif.get(0x9004) ?? ifd0.get(0x0132);
  const offset = exif.get(0x9011) ?? exif.get(0x9012) ?? exif.get(0x9010);
  return typeof original === "string" ? parseExifDate(original, typeof offset === "string" ? offset : null) : null;
}

/** "2026:10:14 10:42:07", in the phone's zone or the one EXIF names ("-06:00"). */
export function parseExifDate(text: string, offset: string | null): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const zone = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim()) : null;
  if (zone) {
    const sign = zone[1] === "-" ? -1 : 1;
    const minutes = sign * (Number(zone[2]) * 60 + Number(zone[3]));
    return Date.UTC(y, mo - 1, d, h, mi, s) - minutes * 60_000;
  }
  const local = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(local) ? local : null;
}
