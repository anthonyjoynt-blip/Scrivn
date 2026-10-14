/**
 * A JPEG header carrying only the EXIF a phone camera writes about time — DateTimeOriginal and, when
 * the phone writes one, OffsetTimeOriginal — for testing lib/exifTime.ts. Little-endian ("II", as
 * Android and iPhone write it) or big-endian ("MM", as some cameras do). Picture data is not needed:
 * the reader stops at the metadata.
 */
export function exifJpeg(dateTime, offset = null, bigEndian = false) {
  const enc = (text) => [...text].map((c) => c.charCodeAt(0)).concat(0);
  const date = enc(dateTime);
  const zone = offset ? enc(offset) : null;
  const entries0 = 1;
  const exifEntries = zone ? 2 : 1;
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + entries0 * 12 + 4;
  const dataAt = exifAt + 2 + exifEntries * 12 + 4;
  const tiff = new Uint8Array(dataAt + date.length + (zone ? zone.length : 0));
  const view = new DataView(tiff.buffer);
  const little = !bigEndian;
  tiff.set(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49], 0);
  view.setUint16(2, 0x2a, little);
  view.setUint32(4, ifd0At, little);
  // IFD0: one entry, the pointer to the EXIF IFD.
  view.setUint16(ifd0At, entries0, little);
  view.setUint16(ifd0At + 2, 0x8769, little);
  view.setUint16(ifd0At + 4, 4, little);
  view.setUint32(ifd0At + 6, 1, little);
  view.setUint32(ifd0At + 10, exifAt, little);
  view.setUint32(ifd0At + 14, 0, little);
  // EXIF IFD: DateTimeOriginal, and OffsetTimeOriginal.
  view.setUint16(exifAt, exifEntries, little);
  const entry = (i, tag, length, at) => {
    const e = exifAt + 2 + i * 12;
    view.setUint16(e, tag, little);
    view.setUint16(e + 2, 2, little);
    view.setUint32(e + 4, length, little);
    view.setUint32(e + 8, at, little);
  };
  entry(0, 0x9003, date.length, dataAt);
  if (zone) entry(1, 0x9011, zone.length, dataAt + date.length);
  view.setUint32(exifAt + 2 + exifEntries * 12, 0, little);
  tiff.set(date, dataAt);
  if (zone) tiff.set(zone, dataAt + date.length);

  const header = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
  const length = 2 + header.length + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...header, ...tiff, 0xff, 0xd9]);
}
