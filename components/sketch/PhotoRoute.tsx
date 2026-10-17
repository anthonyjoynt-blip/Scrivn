"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultRoof, type Exterior, type ExteriorOpening, type ExteriorOpeningKind, type ExteriorSide, exteriorQuantities, OPENING_LABEL, openingRect } from "@/lib/exterior";
import { type CheckRow, openChecks, withCheckDrop, withChecksClosed, withOpeningKind } from "@/lib/exteriorCheck";
import { frameX, frameY } from "@/lib/exteriorPhoto";
import { exifTakenAt } from "@/lib/exifTime";
import { onDeviceChange } from "@/lib/deviceClaims";
import { keepPhotoFile, sendWaitingPhotos } from "@/lib/devicePhotos";
import { preparePhoto } from "@/lib/photoImage";
import { addPhoto, type ClaimPhoto, EXTERIOR_ROOM } from "@/lib/photos";
import { type CornerTap, emptyPhotoRoute, type PhotoRouteState, type RoutePhoto, type RouteShot, type RouteTape, type TapeWhat } from "@/lib/photoRoute";
import { routeCoverage, viewsFromMeasure } from "@/lib/photoRouteCoverage";
import { measureRoute, type PhotoPixelsIn, photoLines } from "@/lib/photoRouteData";
import { exifFocal35, focalOverWidth } from "@/lib/photoRouteExif";
import { exteriorFromRoute, measuredFrom } from "@/lib/photoRouteExterior";
import type { Pt } from "@/lib/roof";
import { formatFeetInches, parseFeetInches } from "@/lib/sketch";
import { FootprintDraw } from "./ExteriorPlan";
import { Choice, FeetField } from "./exteriorFields";
import { claimPhotoUrl, useExteriorPhotos } from "./exteriorPhotoAccess";
import { useExteriorSubject } from "./exteriorSubject";
import styles from "./PhotoRoute.module.css";
import { squaredWallPhoto } from "./SidePhotos";

/**
 * Measuring the outside of the house from photos (2026-10-16): the pane over lib/photoRoute.ts. One
 * screen, top to bottom, in the order it is done:
 *
 *   1. the photos - taken here or picked from the camera roll, kept as the claim's site photos filed
 *      to Exterior, so they wait on the phone with no signal like any other;
 *   2. the house's shape, drawn rough on the plan (sizes do not matter: the photos set them);
 *   3. on each photo, a tap on each corner of the house where it meets the ground. The first one asks
 *      which corner it is, on the shape; the app numbers the rest when it measures;
 *   4. tapes: a line on a photo across what was taped (a garage door, a window), or a wall's length;
 *   5. Measure: the sides, each with its ±, and which want a tape and why; then "Check these", only
 *      what a photo couldn't settle (lib/exteriorCheck.ts), one tap each.
 *
 * Nothing waits on anything: a photo with one corner, a side never seen, no tape at all - it measures
 * what it can and says plainly what would make it better.
 */

const WHAT_LABEL: Record<TapeWhat, string> = { garage: "Garage door", door: "Door", window: "Window", wall: "Wall", other: "Other" };

type RouteChange = (f: (route: PhotoRouteState) => PhotoRouteState) => void;

function withRoute(e: Exterior, f: (route: PhotoRouteState) => PhotoRouteState): Exterior {
  return { ...e, photoRoute: f(e.photoRoute ?? emptyPhotoRoute()) };
}

function mainOf(route: PhotoRouteState) {
  return route.buildings.find((b) => b.id === "main") ?? { id: "main", outline: [] as Pt[], corners: [] as CornerTap[], tapes: [] as RouteTape[] };
}

function withMain(route: PhotoRouteState, f: (b: ReturnType<typeof mainOf>) => ReturnType<typeof mainOf>): PhotoRouteState {
  const b = f(mainOf(route));
  return { ...route, buildings: route.buildings.some((x) => x.id === "main") ? route.buildings.map((x) => (x.id === "main" ? b : x)) : [b, ...route.buildings] };
}

/** The start card beside the other ways in (ExteriorEditor.tsx shows it over ExteriorStart). */
export function PhotoRouteStart({ readOnly, onStart }: { readOnly: boolean; onStart: (exterior: Exterior) => void }) {
  const { the } = useExteriorSubject();
  if (readOnly) return null;
  return (
    <div className={`exterior-start-way ${styles.card}`}>
      <h4 className="exterior-subhead">Measure it from photos</h4>
      <p className="field-note">
        Photos of {the} from all round it, the corners tapped on them, and a tape or two: Scrivn works out every wall&rsquo;s length, and how sure it is of each.
      </p>
      <button type="button" className="btn-primary" onClick={() => onStart({ sides: [], roof: defaultRoof(), photoRoute: emptyPhotoRoute() })}>
        From photos
      </button>
    </div>
  );
}

function TakeCard() {
  const { the } = useExteriorSubject();
  return (
    <div className={styles.card}>
      <strong>How to take the photos</strong>
      <ul>
        <li>Use the normal 1x camera, held sideways.</li>
        <li>One photo of each wall, straight on, with both its corners, the ground and the roof edge in it.</li>
        <li>One photo of each outside corner from 45 degrees, so both walls show.</li>
        <li>Each gable end square-on.</li>
        <li>Walk round {the} in one direction, so the photos follow each other.</li>
      </ul>
    </div>
  );
}

/** A photo's pixels, decoded at its own size. */
async function pixelsOf(id: string, url: string): Promise<PhotoPixelsIn> {
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
  return { id, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, channels: 4 };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function PhotoRoutePane({ exterior, readOnly, onChange }: { exterior: Exterior; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  const access = useExteriorPhotos();
  // "the house", or the other building being measured (2026-10-16): "the shed".
  const { the } = useExteriorSubject();
  const The = the.charAt(0).toUpperCase() + the.slice(1);
  const route = exterior.photoRoute ?? emptyPhotoRoute();
  const main = mainOf(route);
  const change: RouteChange = (f) => onChange((e) => withRoute(e, f));
  const [selected, setSelected] = useState<string | null>(route.photos[0]?.id ?? null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The tap whose corner is being picked on the shape, by its index in the corners. */
  const [picking, setPicking] = useState<number | null>(null);
  const [mode, setMode] = useState<"corners" | "tape" | "wall">("corners");
  const [line, setLine] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const [wallSide, setWallSide] = useState<number | null>(null);

  // Each photo's picture: this phone's copy or Scrivn's link; asked again when the phone's store changes (a photo uploaded).
  const [storeTick, setStoreTick] = useState(0);
  useEffect(() => {
    // A subscription, not a state updater: named, so test:sketch's source rule (stateRules.mjs) doesn't take it for one.
    const bump = () => setStoreTick((n) => n + 1);
    return onDeviceChange(bump);
  }, []);
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void (async () => {
      const next = new Map<string, string>();
      for (const p of route.photos) {
        const u = await claimPhotoUrl(access?.claimId ?? null, p.id);
        if (u) {
          next.set(p.id, u);
          if (u.startsWith("blob:")) made.push(u);
        }
      }
      if (live) setUrls(next);
    })();
    return () => {
      live = false;
      for (const u of made) URL.revokeObjectURL(u);
    };
    // The photos' ids stand for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.photos.map((p) => p.id).join(","), access?.claimId, storeTick]);

  const photo = route.photos.find((p) => p.id === selected) ?? null;
  const tapsHere = main.corners.map((c, i) => ({ c, i })).filter(({ c }) => c.photo === selected);
  const claimExterior = (access?.photos.items ?? []).filter((p) => p.room === EXTERIOR_ROOM && !route.photos.some((q) => q.id === p.id));

  async function addFiles(files: File[], shot?: RouteShot) {
    if (!access) return;
    setError(null);
    const added: RoutePhoto[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setBusy(`Keeping photo ${i + 1} of ${files.length}…`);
        const head = await file.slice(0, 256 * 1024).arrayBuffer();
        const takenAt = exifTakenAt(head) ?? (file.lastModified || Date.now());
        const f35 = exifFocal35(head);
        const prepared = await preparePhoto(file);
        const now = Date.now();
        const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        const record: ClaimPhoto = { id, room: EXTERIOR_ROOM, roomName: "Exterior", takenAt, caption: "", captionBy: null, width: prepared.width, height: prepared.height, source: "gallery", editedAt: now };
        await keepPhotoFile(access.claimIdNow(), id, prepared.full, prepared.thumb);
        access.onPhotosChange((p) => addPhoto(p, record));
        added.push({ id, width: prepared.width, height: prepared.height, takenAt, focalPrior: f35 ? focalOverWidth(f35, prepared.width, prepared.height) : null, ...(shot ? { shot } : {}) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "A photo could not be kept.");
    } finally {
      setBusy(null);
    }
    if (added.length) {
      change((r) => ({ ...r, photos: [...r.photos, ...added].sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0)) }));
      if (!selected) setSelected(added[0]?.id ?? null);
      access.onCheckpoint?.();
      void sendWaitingPhotos();
    }
  }

  function useClaimPhotos() {
    const add: RoutePhoto[] = claimExterior.map((p) => ({ id: p.id, width: p.width, height: p.height, takenAt: p.takenAt, focalPrior: null }));
    change((r) => ({ ...r, photos: [...r.photos, ...add].sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0)) }));
    if (!selected && add[0]) setSelected(add[0].id);
  }

  function addTap(x: number, y: number) {
    if (!selected) return;
    const first = !main.corners.some((c) => c.photo === selected && c.corner >= 0 && c.by === "user");
    const index = main.corners.length;
    change((r) => withMain(r, (b) => ({ ...b, corners: [...b.corners, { photo: selected, corner: -1, x, y }] })));
    // The first corner on a photo: which is it? The app numbers the rest from it.
    if (first) setPicking(index);
  }

  function setCorner(index: number, corner: number) {
    change((r) => withMain(r, (b) => ({ ...b, corners: b.corners.map((c, i) => (i === index ? { photo: c.photo, x: c.x, y: c.y, corner, by: "user" } : c)) })));
    setPicking(null);
  }

  /** A mark Scrivn put down, kept as it is. */
  function keepTap(index: number) {
    change((r) => withMain(r, (b) => ({ ...b, corners: b.corners.map((c, i) => (i === index ? { photo: c.photo, x: c.x, y: c.y, corner: c.corner, by: "app" } : c)) })));
    setPicking(null);
  }

  function removeTap(index: number) {
    change((r) => withMain(r, (b) => ({ ...b, corners: b.corners.filter((_, i) => i !== index) })));
    setPicking(null);
  }

  function addTape(t: RouteTape) {
    change((r) => withMain(r, (b) => ({ ...b, tapes: [...b.tapes, t] })));
  }

  async function measure(keepMarks = false) {
    if (!access) return;
    setError(null);
    // "Looks right": every mark Scrivn put down kept, then measured with them.
    const buildings = keepMarks ? route.buildings.map((b) => (b.id === "main" ? { ...b, corners: b.corners.map((c) => (c.proposed ? { photo: c.photo, x: c.x, y: c.y, corner: c.corner, by: "app" as const } : c)) } : b)) : route.buildings;
    try {
      const have = route.photos.filter((p) => urls.has(p.id));
      const pixels: PhotoPixelsIn[] = [];
      for (const [i, p] of have.entries()) {
        setBusy(`Reading photo ${i + 1} of ${have.length}…`);
        await tick();
        pixels.push(await pixelsOf(p.id, urls.get(p.id) as string));
      }
      const lines = [];
      for (const [i, px] of pixels.entries()) {
        setBusy(`Finding the straight edges: photo ${i + 1} of ${pixels.length}…`);
        await tick();
        lines.push(photoLines(px));
      }
      setBusy("Working out the lens, where each photo was taken, and the walls…");
      await tick();
      const input = { photos: have.map((p) => ({ ...p, width: pixels.find((q) => q.id === p.id)?.width ?? p.width, height: pixels.find((q) => q.id === p.id)?.height ?? p.height })), buildings };
      const { prepared, solution, corners, proposals } = measureRoute(input, "main", pixels, { lines });
      const m = measuredFrom(solution, prepared.data, new Date().toISOString());
      // The marks of the last measure give way to this one's.
      const state = withMain({ ...route, buildings, photos: route.photos }, (b) => ({ ...b, corners: [...corners.filter((c) => !c.proposed), ...proposals] }));
      let failed = false;
      onChange((e) => {
        const next = exteriorFromRoute(e, state, m);
        if (!next) {
          failed = true;
          return withRoute(e, () => ({ ...state, measured: m }));
        }
        return next;
      });
      if (failed) setError("The corners as numbered do not make the shape drawn: check the numbers on each photo.");
      access.onCheckpoint?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photos could not be measured.");
    } finally {
      setBusy(null);
    }
  }

  const measured = route.measured ?? null;
  const placed = new Set((measured?.cameras ?? []).map((c) => c.photo));
  const marks = main.corners.filter((c) => c.proposed);
  const pickedMark = picking !== null && main.corners[picking]?.proposed;
  const ready = main.outline.length >= 4 && new Set(main.corners.filter((c) => !c.proposed && (c.corner >= 0 || main.corners.filter((d) => d.photo === c.photo && !d.proposed).length >= 2)).map((c) => c.photo)).size >= 2;

  if (!access) {
    return <p className="field-note">Open this claim to measure the outside from photos: the photos are kept with the claim.</p>;
  }

  return (
    <div className={styles.pane}>
      {main.outline.length < 4 && <TakeCard />}

      <section>
        <h3>1. The photos</h3>
        <div className={styles.thumbs}>
          {route.photos.map((p, i) => {
            const n = main.corners.filter((c) => c.photo === p.id).length;
            return (
              <button key={p.id} type="button" className={`${styles.thumb} ${p.id === selected ? styles.thumbOn : ""}`} onClick={() => setSelected(p.id)} title={`Photo ${i + 1}`}>
                {urls.get(p.id) ? <img src={urls.get(p.id)} alt={`Photo ${i + 1}`} /> : <span className="field-note">waiting</span>}
                {n > 0 && <span className={styles.badge}>{n}</span>}
              </button>
            );
          })}
        </div>
        {!readOnly && (
          <div className={styles.row}>
            <label className="btn-secondary">
              Take a photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addFiles([...(e.target.files ?? [])]).then(() => (e.target.value = ""))} />
            </label>
            <label className="btn-secondary">
              Choose photos
              <input type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles([...(e.target.files ?? [])]).then(() => (e.target.value = ""))} />
            </label>
            {claimExterior.length > 0 && (
              <button type="button" className="btn-secondary" onClick={useClaimPhotos}>
                Use the {claimExterior.length} Exterior photo{claimExterior.length === 1 ? "" : "s"} already on this claim
              </button>
            )}
          </div>
        )}
        {!readOnly && <p className="field-note">Hold the phone sideways, on the 1x lens.</p>}
        <CoverageList route={route} exterior={exterior} readOnly={readOnly} onTake={(files, shot) => void addFiles(files, shot)} />
      </section>

      <section>
        <h3>2. {The}&rsquo;s shape</h3>
        {main.outline.length < 4 ? (
          readOnly ? (
            <p className="field-note">No shape drawn yet.</p>
          ) : (
            <>
              <p className="field-note">Tap each corner of {the} in turn, going round it, then the first one again. The street side at the bottom. Rough is fine: the photos set the sizes.</p>
              <FootprintDraw onClose={(ring) => change((r) => withMain(r, (b) => ({ ...b, outline: ring, corners: b.corners.map((c) => ({ ...c, corner: -1, by: undefined })) })))} />
            </>
          )
        ) : (
          <>
            <ShapePlan
              outline={measured?.corners ?? main.outline}
              highlight={picking !== null ? null : wallSide}
              pick={picking !== null || mode === "wall" ? (k, kind) => (picking !== null && kind === "corner" ? setCorner(picking, k) : kind === "side" && mode === "wall" ? setWallSide(k) : undefined) : null}
              taped={new Set(main.tapes.filter((t): t is Extract<RouteTape, { kind: "side" }> => t.kind === "side").map((t) => t.from))}
            />
            {!readOnly && (
              <div className={styles.row}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (window.confirm("Draw the shape again? The corners tapped stay; their numbers are cleared.")) change((r) => withMain(r, (b) => ({ ...b, outline: [], corners: b.corners.map((c) => ({ ...c, corner: -1, by: undefined })) })));
                  }}
                >
                  Draw the shape again
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {photo && main.outline.length >= 4 && (
        <section>
          <h3>3. The corners, and the tapes</h3>
          {!readOnly && (
            <div className="option-group" role="group" aria-label="What a tap on the photo does">
              {(
                [
                  ["corners", "Tap corners"],
                  ["tape", "Draw a tape"],
                  ["wall", "A wall's length"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className={`option-btn${mode === v ? " selected" : ""}`} aria-pressed={mode === v} onClick={() => setMode(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="field-note">
            {mode === "corners"
              ? `Tap each corner of ${the} you can see, where it meets the ground. The first one on each photo asks which corner it is; Scrivn numbers the rest. Tap a number to change it.`
              : mode === "tape"
                ? "Drag across what you taped, end to end: a garage door, a window, a door. Then say how long it is."
                : "Tap a side of the shape above, then type its length as you taped it, corner to corner."}
          </p>
          {picking !== null && (
            <div className={styles.ask}>
              {pickedMark ? (
                <p>
                  Scrivn marked corner {(main.corners[picking]?.corner ?? 0) + 1} here, from the measure.{" "}
                  <button type="button" className="link-button" onClick={() => keepTap(picking)}>
                    Keep it
                  </button>{" "}
                  <button type="button" className="link-button" onClick={() => removeTap(picking)}>
                    Take it away
                  </button>{" "}
                  Or tap the corner it is on the shape.
                </p>
              ) : (
                <p>
                  Which corner is this? Tap it on the shape.{" "}
                  <button type="button" className="link-button" onClick={() => removeTap(picking)}>
                    Remove this tap
                  </button>{" "}
                  <button type="button" className="link-button" onClick={() => setPicking(null)}>
                    Leave it to Scrivn
                  </button>
                </p>
              )}
              <div className={styles.askPlan}>
                <ShapePlan outline={measured?.corners ?? main.outline} highlight={null} pick={(k, kind) => kind === "corner" && setCorner(picking, k)} taped={new Set()} />
              </div>
            </div>
          )}
          <PhotoTaps
            url={urls.get(photo.id) ?? null}
            width={photo.width}
            height={photo.height}
            taps={tapsHere}
            tapes={main.tapes.filter((t): t is Extract<RouteTape, { kind: "line" }> => t.kind === "line" && t.photo === photo.id)}
            line={line}
            mode={readOnly ? null : mode}
            selected={picking}
            onTap={addTap}
            onPickTap={(i) => setPicking(i)}
            onLine={(a, b) => setLine({ a, b })}
          />
          {placed.size > 0 && !placed.has(photo.id) && measured && (
            <p className={styles.weak}>{measured.unplaced.find((u) => u.photo === photo.id)?.why ?? "Not used in the last measure."}</p>
          )}
          {line && <TapeForm onCancel={() => setLine(null)} onDone={(what, feet) => (addTape({ id: `tape-${Date.now().toString(36)}`, kind: "line", photo: photo.id, a: line.a, b: line.b, feet, what }), setLine(null))} />}
          {mode === "wall" && wallSide !== null && (
            <WallTapeForm
              onCancel={() => setWallSide(null)}
              onDone={(feet) => {
                addTape({ id: `tape-${Date.now().toString(36)}`, kind: "side", from: wallSide, feet });
                setWallSide(null);
              }}
            />
          )}
          {main.tapes.length > 0 && (
            <ul className="field-note">
              {main.tapes.map((t) => (
                <li key={t.id}>
                  {t.kind === "line" ? `${WHAT_LABEL[t.what]} on photo ${route.photos.findIndex((p) => p.id === t.photo) + 1}` : `Side from corner ${t.from + 1} to ${((t.from + 1) % main.outline.length) + 1}`}: {formatFeetInches(t.feet)}{" "}
                  {!readOnly && (
                    <button type="button" className="link-button" onClick={() => change((r) => withMain(r, (b) => ({ ...b, tapes: b.tapes.filter((x) => x.id !== t.id) })))}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3>4. Measure</h3>
        {!readOnly && (
          <button type="button" className="btn-primary" disabled={!ready || busy !== null} onClick={() => void measure(false)}>
            {measured ? "Measure again" : `Measure ${the}`}
          </button>
        )}
        {!ready && <p className="field-note">Measuring needs the shape drawn and two photos at least with two corners each.</p>}
        {busy && <p className="field-note">{busy}</p>}
        {error && <p className="sketch-length-error">{error}</p>}
        {measured && <Results exterior={exterior} route={route} />}
        {measured && marks.length > 0 && (
          <div className={styles.card}>
            <p>
              Scrivn marked {marks.length} more corner{marks.length === 1 ? "" : "s"}, dashed, where the measure puts {marks.length === 1 ? "it" : "them"} on the photos it placed. Tap one that is wrong to take it away or renumber it.
            </p>
            {!readOnly && (
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void measure(true)}>
                Looks right
              </button>
            )}
          </div>
        )}
        {measured && <CheckThese exterior={exterior} readOnly={readOnly} onChange={onChange} />}
      </section>
    </div>
  );
}

/** The last measure: each side with its length and ±, what wants a tape, and the photos not used. */
function Results({ exterior, route }: { exterior: Exterior; route: PhotoRouteState }) {
  const m = route.measured;
  if (!m) return null;
  const n = m.corners.length;
  const ids = m.sideIds ?? [];
  const name = (from: number) => exterior.sides.find((s) => s.id === ids[from])?.name ?? `Side ${from + 1}`;
  const tapes = mainOf(route).tapes.length;
  return (
    <div>
      <p className="field-note">
        Measured from {m.cameras.length} of {route.photos.length} photos{tapes ? ` and ${tapes} tape${tapes === 1 ? "" : "s"}` : ", with no tape: the sizes follow the shape as drawn"}.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Side</th>
            <th scope="col">Length</th>
            <th scope="col">±</th>
          </tr>
        </thead>
        <tbody>
          {m.sides.map((s) => (
            <tr key={s.from}>
              <th scope="row">
                {name(s.from)} <span className="field-note">(corners {s.from + 1}–{((s.from + 1) % n) + 1})</span>
              </th>
              <td>{formatFeetInches(s.lengthFeet)}</td>
              <td className={(s.plusMinusPct ?? 0) > 5 ? styles.weak : undefined}>{s.taped ? "taped" : `${s.plusMinusPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.advice.length > 0 && (
        <>
          <h4 className="exterior-subhead">A tape would help</h4>
          <ul className="field-note">
            {m.advice.map((a) => (
              <li key={a.from}>
                {name(a.from)}: {a.why}
              </li>
            ))}
          </ul>
        </>
      )}
      {m.unplaced.length > 0 && (
        <>
          <h4 className="exterior-subhead">Photos not used</h4>
          <ul className="field-note">
            {m.unplaced.map((u) => (
              <li key={u.photo}>
                Photo {route.photos.findIndex((p) => p.id === u.photo) + 1}: {u.why}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const KIND_OPTIONS = (Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((k): [ExteriorOpeningKind, string] => [k, OPENING_LABEL[k]]);

/**
 * "Check these" (2026-10-16, lib/exteriorCheck.ts): only what a photo couldn't settle - an opening it hid
 * part of, a door up off the ground with nothing at its foot, a lower roof's assumed drop. One tap each;
 * "Looks right" closes it and whatever was not answered stays as read.
 */
function CheckThese({ exterior, readOnly, onChange }: { exterior: Exterior; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  const q = useMemo(() => exteriorQuantities(exterior), [exterior]);
  const rows = openChecks(exterior, q);
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="exterior-subhead">Check these</h4>
      <p className="field-note">What the photos couldn&rsquo;t show for sure. Anything left stays as read.</p>
      {rows.map((r) => (
        <div key={r.key} className={styles.check}>
          <CheckRowView exterior={exterior} row={r} readOnly={readOnly} onChange={onChange} />
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn-primary" onClick={() => onChange((e) => withChecksClosed(e, rows.map((r) => r.key)))}>
          Looks right
        </button>
      )}
    </div>
  );
}

function CheckRowView({ exterior, row, readOnly, onChange }: { exterior: Exterior; row: CheckRow; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  if (row.kind === "drop") {
    return (
      <FeetField
        id={`check-${row.sideId}`}
        label={row.question}
        value={null}
        placeholder={`${formatFeetInches(row.feet)} assumed`}
        readOnly={readOnly}
        allowZero
        nullable
        onCommit={(v) => v !== null && onChange((e) => withCheckDrop(e, row.sideId, v))}
      />
    );
  }
  const side = exterior.sides.find((s) => s.id === row.sideId);
  const opening = side?.openings.find((o) => o.id === row.openingId);
  return (
    <>
      {side && opening && <OpeningCrop side={side} opening={opening} />}
      <Choice
        label={row.title}
        hint={`${row.words} As read: ${OPENING_LABEL[row.openingKind].toLowerCase()}.`}
        value={row.openingKind}
        readOnly={readOnly}
        options={KIND_OPTIONS}
        onChange={(k) => onChange((e) => withOpeningKind(e, row.sideId, row.openingId, k))}
      />
    </>
  );
}

/** The crop's longest side, CSS pixels. */
const CROP_PX = 240;

/** The opening cut out of its side's squared photo, outlined, with a little wall round it: what the question is about. */
function OpeningCrop({ side, opening }: { side: ExteriorSide; opening: ExteriorOpening }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const job = squaredWallPhoto(side);
    if (!job) {
      setShown(false);
      return;
    }
    let live = true;
    job.then(
      ({ frame, canvas }) => {
        const out = ref.current;
        const ctx = out?.getContext("2d");
        if (!live || !out || !ctx) return;
        const M = 0.3048;
        const r = openingRect(side, opening);
        const pad = Math.max(1.5, 0.3 * Math.max(r.x1 - r.x0, r.y1 - r.y0));
        const sx = frameX(frame, (r.x0 - pad) * M);
        const sy = frameY(frame, (r.y1 + pad) * M);
        const sw = frameX(frame, (r.x1 + pad) * M) - sx;
        const sh = frameY(frame, (r.y0 - pad) * M) - sy;
        const scale = Math.min(CROP_PX / sw, CROP_PX / sh) * Math.min(2, window.devicePixelRatio || 1);
        out.width = Math.max(1, Math.round(sw * scale));
        out.height = Math.max(1, Math.round(sh * scale));
        ctx.setTransform(scale, 0, 0, scale, -sx * scale, -sy * scale);
        ctx.drawImage(canvas, 0, 0);
        ctx.strokeStyle = "#ea580c";
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(frameX(frame, r.x0 * M), frameY(frame, r.y1 * M), (r.x1 - r.x0) * M * frame.ppm, (r.y1 - r.y0) * M * frame.ppm);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        setShown(true);
      },
      () => live && setShown(false),
    );
    return () => {
      live = false;
    };
  }, [side, opening]);
  if (!shown) return null;
  return <canvas ref={ref} className={styles.crop} role="img" aria-label={`The ${OPENING_LABEL[opening.kind].toLowerCase()} on ${side.name}, from its photo`} />;
}

/**
 * What to take next (2026-10-17, lib/photoRouteCoverage.ts): live from the shape and the photos so far - before
 * a measure, the corners tapped on them; after one, what each placed photo sees. A small plan with what is thin
 * in orange, and each photo still worth taking in plain words with a camera button that tags the photo with what
 * it was taken for, so its corners are named by it. Advice only: Measure works any time.
 */
function CoverageList({ route, exterior, readOnly, onTake }: { route: PhotoRouteState; exterior: Exterior; readOnly: boolean; onTake: (files: File[], shot: RouteShot) => void }) {
  const [all, setAll] = useState(false);
  const main = mainOf(route);
  const m = route.measured ?? null;
  const ring = m?.corners ?? main.outline;
  if (ring.length < 4) return null;
  const n = ring.length;
  const ids = m?.sideIds ?? [];
  const cov = routeCoverage({
    ring,
    views: m ? viewsFromMeasure(m) : [],
    taps: main.corners.filter((c) => !c.proposed && c.corner >= 0).map((c) => ({ photo: c.photo, corner: c.corner })),
    shots: route.photos.flatMap((p) => (p.shot ? [{ photo: p.id, shot: p.shot }] : [])),
    measured: !!m,
    gables: ids.flatMap((id, i) => (exterior.roof.ends[id] === "gable" ? [i] : [])),
    wallName: (i) => exterior.sides.find((s) => s.id === ids[i])?.name ?? null,
  });
  // In orange: each corner and wall the list asks a photo of.
  const thin = {
    corners: new Set(cov.items.flatMap((it) => (it.corner !== undefined ? [it.corner] : []))),
    walls: new Set(cov.items.flatMap((it) => (it.wall !== undefined ? [it.wall] : []))),
  };
  const seen = cov.corners.filter((c) => c.photos.length >= 2).length;
  const both = cov.walls.filter((w) => w.both.length > 0).length;
  const shown = all ? cov.items : cov.items.slice(0, 4);
  return (
    <div className={styles.cover}>
      <h4 className="exterior-subhead">What to take next</h4>
      {cov.items.length === 0 ? (
        <p className="field-note">The photos cover every corner and every wall{m ? "" : ", as tapped so far"}.</p>
      ) : (
        <>
          <div className={styles.coverRow}>
            <div className={styles.coverPlan}>
              <ShapePlan outline={ring} pick={null} highlight={null} taped={new Set()} thin={thin} />
            </div>
            <p className="field-note">
              {m
                ? `${seen} of ${n} corners are in two photos or more, and ${both} of ${n} walls have a photo with both corners in, counting the photos the measure placed. In orange: what the list asks for.`
                : `${cov.items.length} photo${cov.items.length === 1 ? "" : "s"} to take, from the shape, in orange. A photo added another way counts once Measure has placed it.`}{" "}
              Advice only: Measure works any time.
            </p>
          </div>
          <ul className={styles.coverList}>
            {shown.map((it) => (
              <li key={it.key}>
                <span>{it.words}</span>
                {!readOnly && (
                  <label className="btn-secondary">
                    Take it
                    <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onTake([...(e.target.files ?? [])], it.shot), (e.target.value = ""))} />
                  </label>
                )}
              </li>
            ))}
          </ul>
          {cov.items.length > 4 && (
            <button type="button" className="link-button" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show ${cov.items.length - 4} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The shape with its corners numbered; corners or sides tappable when something is being picked. */
function ShapePlan({
  outline,
  pick,
  highlight,
  taped,
  thin,
}: {
  outline: Pt[];
  pick: ((k: number, kind: "corner" | "side") => void) | null;
  highlight: number | null;
  taped: Set<number>;
  /** What the photos cover thinly (lib/photoRouteCoverage.ts), in orange. */
  thin?: { corners: Set<number>; walls: Set<number> };
}) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const pad = span * 0.12;
  const W = x1 - x0 + 2 * pad;
  const H = y1 - y0 + 2 * pad;
  // Plan y is up; the SVG's is down.
  const P = (p: Pt) => ({ x: p.x - x0 + pad, y: y1 - p.y + pad });
  const r = span * 0.035;
  const n = outline.length;
  return (
    <svg className={styles.plan} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The house's shape, its corners numbered">
      <polygon points={outline.map((p) => `${P(p).x},${P(p).y}`).join(" ")} fill="rgba(8,145,178,0.08)" stroke="#0891b2" strokeWidth={span * 0.008} />
      {outline.map((a, i) => {
        const b = outline[(i + 1) % n] as Pt;
        const A = P(a);
        const B = P(b);
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        return (
          <g key={`s${i}`}>
            <line
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke={highlight === i || thin?.walls.has(i) ? "#ea580c" : taped.has(i) ? "#15803d" : "transparent"}
              strokeWidth={span * 0.02}
              strokeDasharray={thin?.walls.has(i) && highlight !== i ? `${span * 0.03} ${span * 0.02}` : undefined}
            />
            {pick && <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="transparent" strokeWidth={span * 0.06} style={{ cursor: "pointer" }} onClick={() => pick(i, "side")} />}
            {taped.has(i) && (
              <text x={mid.x} y={mid.y} fontSize={span * 0.04} textAnchor="middle" fill="#15803d">
                taped
              </text>
            )}
          </g>
        );
      })}
      {outline.map((p, i) => {
        const q = P(p);
        return (
          <g key={`c${i}`} style={{ cursor: pick ? "pointer" : undefined }} onClick={() => pick?.(i, "corner")}>
            <circle cx={q.x} cy={q.y} r={r} fill={pick || thin?.corners.has(i) ? "#ea580c" : "#0891b2"} />
            <text x={q.x} y={q.y + r * 0.4} fontSize={r * 1.15} textAnchor="middle" fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A photo with its corner taps (numbered, or ? until numbered) and its tapes, taking taps and drags in its own pixels. */
function PhotoTaps({
  url,
  width,
  height,
  taps,
  tapes,
  line,
  mode,
  selected,
  onTap,
  onPickTap,
  onLine,
}: {
  url: string | null;
  width: number;
  height: number;
  taps: { c: CornerTap; i: number }[];
  tapes: Extract<RouteTape, { kind: "line" }>[];
  line: { a: [number, number]; b: [number, number] } | null;
  mode: "corners" | "tape" | "wall" | null;
  selected: number | null;
  onTap: (x: number, y: number) => void;
  onPickTap: (i: number) => void;
  onLine: (a: [number, number], b: [number, number]) => void;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const start = useRef<{ x: number; y: number; px: [number, number] } | null>(null);
  const toPhoto = (e: ReactPointerEvent): [number, number] => {
    const el = svg.current;
    if (!el) return [0, 0];
    const box = el.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * width, ((e.clientY - box.top) / box.height) * height];
  };
  const r = width / 90;
  const shown = drag ?? line;
  return (
    <div className={styles.photoBox}>
      {url ? <img src={url} alt="The photo, to tap the corners on" draggable={false} /> : <div style={{ aspectRatio: `${width} / ${height}`, background: "#e7e5e4" }} />}
      <svg
        ref={svg}
        className={styles.overlay}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={(e) => {
          if (!mode || mode === "wall") return;
          start.current = { x: e.clientX, y: e.clientY, px: toPhoto(e) };
          if (mode === "tape") (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (mode === "tape" && start.current) setDrag({ a: start.current.px, b: toPhoto(e) });
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (!s || !mode) return;
          const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
          if (mode === "corners" && moved < 10) onTap(...toPhoto(e));
          if (mode === "tape") {
            const b = toPhoto(e);
            setDrag(null);
            if (Math.hypot(b[0] - s.px[0], b[1] - s.px[1]) > width / 60) onLine(s.px, b);
          }
        }}
      >
        {tapes.map((t) => (
          <g key={t.id}>
            <line x1={t.a[0]} y1={t.a[1]} x2={t.b[0]} y2={t.b[1]} stroke="#15803d" strokeWidth={r / 3} />
            <text x={(t.a[0] + t.b[0]) / 2} y={(t.a[1] + t.b[1]) / 2 - r} fontSize={r * 1.6} textAnchor="middle" fill="#15803d" stroke="#fff" strokeWidth={r / 6} paintOrder="stroke">
              {formatFeetInches(t.feet)}
            </text>
          </g>
        ))}
        {shown && <line x1={shown.a[0]} y1={shown.a[1]} x2={shown.b[0]} y2={shown.b[1]} stroke="#ea580c" strokeWidth={r / 3} strokeDasharray={`${r} ${r / 2}`} />}
        {taps.map(({ c, i }) => (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPickTap(i);
            }}
          >
            <line x1={c.x} y1={c.y - r * 6} x2={c.x} y2={c.y} stroke={selected === i ? "#ea580c" : "#0891b2"} strokeWidth={r / 4} strokeDasharray={c.proposed ? `${r / 1.5} ${r / 2.5}` : undefined} />
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={c.proposed ? "rgba(8,145,178,0.35)" : selected === i ? "#ea580c" : c.corner >= 0 ? "#0891b2" : "#78716c"}
              stroke={c.proposed ? (selected === i ? "#ea580c" : "#0891b2") : "#fff"}
              strokeWidth={r / 5}
              strokeDasharray={c.proposed ? `${r / 2} ${r / 3}` : undefined}
            />
            <text x={c.x} y={c.y + r * 0.42} fontSize={r * 1.2} textAnchor="middle" fill="#fff" stroke={c.proposed ? "#0e7490" : undefined} strokeWidth={c.proposed ? r / 8 : undefined} paintOrder="stroke">
              {c.corner >= 0 ? c.corner + 1 : "?"}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function TapeForm({ onCancel, onDone }: { onCancel: () => void; onDone: (what: TapeWhat, feet: number) => void }) {
  const [what, setWhat] = useState<TapeWhat>("garage");
  const [text, setText] = useState("");
  const feet = parseFeetInches(text);
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <button type="button" className="btn-secondary" onClick={() => onDone("garage", 9)}>
          9&prime; garage door
        </button>
        <button type="button" className="btn-secondary" onClick={() => onDone("garage", 16)}>
          16&prime; garage door
        </button>
      </div>
      <div className="option-group" role="group" aria-label="What was taped">
        {(Object.keys(WHAT_LABEL) as TapeWhat[]).map((w) => (
          <button key={w} type="button" className={`option-btn${what === w ? " selected" : ""}`} aria-pressed={what === w} onClick={() => setWhat(w)}>
            {WHAT_LABEL[w]}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <label>
          Its length{" "}
          <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={`e.g. 3'2"`} size={10} />
        </label>
        <button type="button" className="btn-primary" disabled={feet === null || !(feet > 0)} onClick={() => feet && onDone(what, feet)}>
          Add the tape
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WallTapeForm({ onCancel, onDone }: { onCancel: () => void; onDone: (feet: number) => void }) {
  const [text, setText] = useState("");
  const feet = parseFeetInches(text);
  return (
    <div className={`${styles.card} ${styles.row}`}>
      <label>
        The side&rsquo;s length, corner to corner{" "}
        <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={`e.g. 22'2"`} size={10} autoFocus />
      </label>
      <button type="button" className="btn-primary" disabled={feet === null || !(feet > 0)} onClick={() => feet && onDone(feet)}>
        Add the tape
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

