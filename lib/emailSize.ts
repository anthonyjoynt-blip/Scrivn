/**
 * How much Send documents can carry, and what to say when a set is over it (2026-10-14).
 *
 * The PDFs are built in the browser and posted to /api/send-documents in one request. That route
 * runs as a Vercel function, and Vercel refuses a request body over 4.5 MB before the route sees a
 * byte — so the route's own 20 MB check never gets its chance, and the estimator would get a bare
 * "413" for a report full of photos. So the size is checked here, before sending, and the answer is a
 * sentence that says what to do.
 */

/** Vercel's 4.5 MB body limit, less room for the form's other fields and its boundaries. */
export const EMAIL_LIMIT_BYTES = Math.floor(4.4 * 1024 * 1024);

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentSize {
  label: string;
  bytes: number;
  /** Photos printed in it, when it has any. */
  photos?: number;
}

/** Null when the set fits; otherwise what to tell the estimator, plainly. */
export function tooBigToEmail(parts: AttachmentSize[], limit = EMAIL_LIMIT_BYTES): string | null {
  const total = parts.reduce((sum, p) => sum + p.bytes, 0);
  if (total <= limit) return null;
  const biggest = [...parts].sort((a, b) => b.bytes - a.bytes)[0]!;
  const withPhotos = biggest.photos ? `, most of it its ${biggest.photos} photo${biggest.photos === 1 ? "" : "s"}` : "";
  const fix = biggest.photos
    ? `Leave its photos out (untick Photos on the ${biggest.label}) and send again, or download it and attach it to an email yourself.`
    : `Download it and attach it to an email yourself.`;
  if (biggest.bytes > limit) {
    return `The ${biggest.label} alone is ${megabytes(biggest.bytes)}${withPhotos} — more than Scrivn can email at once (${megabytes(limit)}). ${fix}`;
  }
  return `Together these come to ${megabytes(total)}, more than Scrivn can email at once (${megabytes(limit)}). The ${biggest.label} is ${megabytes(biggest.bytes)} of it${withPhotos}. Send it on its own, then the rest.`;
}
