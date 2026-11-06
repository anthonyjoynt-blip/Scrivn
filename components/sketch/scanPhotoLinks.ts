/**
 * Where a scan's photos are on scrivn.ca (2026-10-29, moved out of Sketch3D.tsx): signed links from
 * `/api/scans/<id>/photos`, by photo number. A scan whose photos Scrivn will not give back has none;
 * no answer at all (no signal) rejects, and the view keeps waiting for them.
 *
 * On its own so Scrivn Scan's copy of the editor can leave it out (scripts/build-scan-editor.mjs):
 * there the photos are on the phone, and the page has no network.
 */
export async function scanPhotoLinks(scanId: string): Promise<Record<number, string>> {
  const r = await fetch(`/api/scans/${scanId}/photos`);
  const body = (r.ok ? await r.json() : { photos: [] }) as { photos?: { n: number; url: string }[] };
  const byN: Record<number, string> = {};
  for (const p of body.photos ?? []) byN[p.n] = p.url;
  return byN;
}
