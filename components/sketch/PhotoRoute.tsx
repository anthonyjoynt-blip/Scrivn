"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultRoof, type Exterior, type ExteriorOpening, type ExteriorOpeningKind, type ExteriorSide, exteriorQuantities, HOME_TYPE_LABEL, type HomeType, isAttachedHome, OPENING_LABEL, openingRect } from "@/lib/exterior";
import { type CheckRow, openChecks, withCheckDrop, withChecksClosed, withOpeningKind, withTrimAnswer } from "@/lib/exteriorCheck";
import { frameX, frameY } from "@/lib/exteriorPhoto";
import { exifTakenAt } from "@/lib/exifTime";
import { onDeviceChange } from "@/lib/deviceClaims";
import { keepPhotoFile, sendWaitingPhotos } from "@/lib/devicePhotos";
import { preparePhoto } from "@/lib/photoImage";
import { addPhoto, type ClaimPhoto, EXTERIOR_ROOM } from "@/lib/photos";
import { type CornerTap, defaultShared, emptyPhotoRoute, type PhotoRouteState, planMapping, type RoutePhoto, type RouteShot, type RouteTape, type TapeWhat } from "@/lib/photoRoute";
import { routeSanity } from "@/lib/photoRouteSanity";
import { routeCoverage, viewsFromMeasure } from "@/lib/photoRouteCoverage";
import { measureRoute, type PhotoPixelsIn, photoLines } from "@/lib/photoRouteData";
import { exifFocal35, focalOverWidth } from "@/lib/photoRouteExif";
import { exteriorFromRoute, measuredFrom } from "@/lib/photoRouteExterior";
import type { Pt } from "@/lib/roof";
import { formatFeetInches, newSketchId } from "@/lib/sketch";
import { FeetInchesInput } from "./FeetInchesInput";
import { FootprintDraw } from "./ExteriorPlan";
import { decksOf, uniqueDeckName, withDeckAdded, withDeckAnswer, withDeckChange, withDeckDepth } from "@/lib/decks";
import { deckFromPhotos, type DeckPhotoTap } from "@/lib/deckPhotos";
import { Choice, CountInput, FeetField } from "./exteriorFields";
import { claimPhotoUrl, useExteriorPhotos } from "./exteriorPhotoAccess";
import { useExteriorSubject } from "./exteriorSubject";
import styles from "./PhotoRoute.module.css";
import { squaredWallPhoto } from "./SidePhotos";
import { SendToTeam } from "./TeamMeasure";

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

/** A tap as kept: no longer a mark of Scrivn's to keep or not; still where this home ends if it was. */
function kept(c: CornerTap): CornerTap {
  const { proposed: _mark, ...rest } = c;
  return rest;
}

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
        <li>One photo at 45 degrees to every outside corner, the back ones and any behind a porch too, both walls in frame.</li>
        <li>Each gable end square-on.</li>
        <li>Walk round {the} in one direction, so the photos follow each other.</li>
        <li>One tape front to back: the long side wall, front corner to back corner.</li>
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
  const { the, isHouse } = useExteriorSubject();
  const The = the.charAt(0).toUpperCase() + the.slice(1);
  const route = exterior.photoRoute ?? emptyPhotoRoute();
  const main = mainOf(route);
  // A semi or a townhouse (2026-10-17): its walls shared with the neighbours, by the outline's side index.
  const attached = isAttachedHome(main.homeType);
  const sharedSides = new Set(main.shared ?? []);
  const change: RouteChange = (f) => onChange((e) => withRoute(e, f));
  const [selected, setSelected] = useState<string | null>(route.photos[0]?.id ?? null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The tap whose corner is being picked on the shape, by its index in the corners. */
  const [picking, setPicking] = useState<number | null>(null);
  const [mode, setMode] = useState<"corners" | "ends" | "tape" | "wall">("corners");
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
    // In "Where this home ends", the tap is the party line: a corner of a shared wall.
    change((r) => withMain(r, (b) => ({ ...b, corners: [...b.corners, { photo: selected, corner: -1, x, y, ...(mode === "ends" ? { party: true as const } : {}) }] })));
    // The first corner on a photo: which is it? The app numbers the rest from it.
    if (first) setPicking(index);
  }

  function setCorner(index: number, corner: number) {
    change((r) => withMain(r, (b) => ({ ...b, corners: b.corners.map((c, i) => (i === index ? { ...kept(c), corner, by: "user" } : c)) })));
    setPicking(null);
  }

  /** A mark Scrivn put down, kept as it is. */
  function keepTap(index: number) {
    change((r) => withMain(r, (b) => ({ ...b, corners: b.corners.map((c, i) => (i === index ? { ...kept(c), by: "app" } : c)) })));
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
    const buildings = keepMarks ? route.buildings.map((b) => (b.id === "main" ? { ...b, corners: b.corners.map((c) => (c.proposed ? { ...kept(c), by: "app" as const } : c)) } : b)) : route.buildings;
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
        {isHouse && (
          <div className="option-group" role="group" aria-label="The home">
            {(Object.keys(HOME_TYPE_LABEL) as HomeType[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`option-btn${(main.homeType ?? "detached") === k ? " selected" : ""}`}
                aria-pressed={(main.homeType ?? "detached") === k}
                disabled={readOnly}
                onClick={() => change((r) => withMain(r, (b) => ({ ...b, homeType: k, shared: defaultShared(b.outline, k) })))}
              >
                {HOME_TYPE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        {main.outline.length < 4 ? (
          readOnly ? (
            <p className="field-note">No shape drawn yet.</p>
          ) : (
            <>
              <p className="field-note">Tap each corner of {the} in turn, going round it, then the first one again. The street side at the bottom. Rough is fine: the photos set the sizes.</p>
              <FootprintDraw onClose={(ring) => change((r) => withMain(r, (b) => ({ ...b, outline: ring, shared: defaultShared(ring, b.homeType), corners: b.corners.map((c) => ({ ...c, corner: -1, by: undefined })) })))} />
            </>
          )
        ) : (
          <>
            <ShapePlan
              outline={measured?.corners ?? main.outline}
              highlight={picking !== null ? null : wallSide}
              pick={
                picking !== null || mode === "wall" || (attached && !readOnly)
                  ? (k, kind) =>
                      picking !== null && kind === "corner"
                        ? setCorner(picking, k)
                        : kind === "side" && mode === "wall"
                          ? setWallSide(k)
                          : kind === "side" && attached && picking === null
                            ? change((r) => withMain(r, (b) => ({ ...b, shared: (b.shared ?? []).includes(k) ? (b.shared ?? []).filter((i) => i !== k) : [...(b.shared ?? []), k].sort((p, q) => p - q) })))
                            : undefined
                  : null
              }
              taped={new Set(main.tapes.filter((t): t is Extract<RouteTape, { kind: "side" }> => t.kind === "side").map((t) => t.from))}
              shared={sharedSides}
              pickCorners={picking !== null}
            />
            {attached && <p className="field-note">Shared with the neighbour, in grey: not photographed, not counted. Tap a wall to change it.</p>}
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
                  ...(attached ? ([["ends", "Where this home ends"]] as const) : []),
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
            {mode === "ends"
              ? "On a front or back photo, tap where this home ends, at the ground: the party line, often a downspout, a trim line, or where the siding or colour changes. What's past it is the neighbour's and isn't measured."
              : mode === "corners"
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
          {measured && !readOnly && main.corners.filter((c) => c.photo === photo.id && !c.proposed).length <= 1 && (!placed.has(photo.id) || photo.standAt) && (
            <StandPicker
              drawn={main.outline}
              measured={measured}
              photo={photo}
              onPick={(at) => change((r) => ({ ...r, photos: r.photos.map((p) => (p.id === photo.id ? { ...p, standAt: at } : p)) }))}
            />
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
          <div className={styles.row}>
            <button type="button" className="btn-primary" disabled={!ready || busy !== null} onClick={() => void measure(false)}>
              {measured ? "Measure again" : `Measure ${the}`}
            </button>
            {/* Or the Scrivn team measures it from these photos and tapes (2026-10-17, lib/exteriorRequests.ts). */}
            <SendToTeam exterior={exterior} readOnly={readOnly} apply={(f) => onChange((e) => f(e))} />
          </div>
        )}
        {!ready && <p className="field-note">Measuring needs the shape drawn and two photos at least with two corners each.</p>}
        {busy && <p className="field-note">{busy}</p>}
        {error && <p className="sketch-length-error">{error}</p>}
        {measured && <Results exterior={exterior} route={route} />}
        {measured && <WorthALook exterior={exterior} />}
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

      {measured && <DeckSection exterior={exterior} route={route} urls={urls} readOnly={readOnly} onChange={onChange} />}
    </div>
  );
}

/** Which point a deck tap is, in words, and its short mark on the photo. */
const DECK_POINTS: { point: string; words: string; mark: string }[] = [
  { point: "corner:0", words: "Its left outer corner, at the ground", mark: "L" },
  { point: "corner:1", words: "Its right outer corner, at the ground", mark: "R" },
  { point: "top:0", words: "Its top over the left corner", mark: "L↑" },
  { point: "top:1", words: "Its top over the right corner", mark: "R↑" },
];

/**
 * 5. Decks (2026-10-20, lib/deckPhotos.ts): a deck on the same photos, placed by the cameras the measure just placed. The
 * wall it stands against, then on each photo that shows them its two outer corners where they meet the ground (a post's
 * foot), and its top over one of them - left and right as you face that wall from outside. The rest is the house's: from
 * its outer edge back to the walls, a covered corner filled. Its railings, stairs and posts are put in on the Decks tab.
 */
function DeckSection({ exterior, route, urls, readOnly, onChange }: { exterior: Exterior; route: PhotoRouteState; urls: Map<string, string>; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  const m = route.measured as NonNullable<PhotoRouteState["measured"]>;
  const placed = route.photos.filter((p) => m.cameras.some((c) => c.photo === p.id));
  const [draft, setDraft] = useState<{ side: number | null; deckId: string | null; name: string; taps: DeckPhotoTap[]; point: string } | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(placed[0]?.id ?? null);
  const [why, setWhy] = useState<string[]>([]);
  const onPhotos = decksOf(exterior).filter((d) => d.from === "photos");
  const photo = placed.find((p) => p.id === photoId) ?? null;
  const sideName = (i: number) => exterior.sides.find((s) => s.id === m.sideIds?.[i])?.name ?? `Side ${i + 1}`;
  const markOf = (point: string) => DECK_POINTS.find((p) => p.point === point)?.mark ?? "?";

  function place() {
    if (!draft || draft.side === null) return;
    const prev = draft.deckId ? (decksOf(exterior).find((d) => d.id === draft.deckId) ?? null) : null;
    const made = deckFromPhotos(m, draft.side, draft.taps, prev, { id: draft.deckId ?? newSketchId("deck"), name: draft.name });
    setWhy(made.why);
    const deck = made.deck;
    if (!deck) return;
    onChange((e) => (decksOf(e).some((d) => d.id === deck.id) ? withDeckChange(e, deck.id, () => deck) : withDeckAdded(e, deck)));
    setDraft(null);
  }

  return (
    <section>
      <h3>5. Decks</h3>
      <p className="field-note">A deck or porch on these photos: its corners tapped as the house&rsquo;s are. Its railings, stairs and posts go in on the Decks tab.</p>
      {onPhotos.map((d) => (
        <div key={d.id} className={styles.row}>
          <span>
            {d.name}
            {d.sideId ? ` · against ${exterior.sides.find((s) => s.id === d.sideId)?.name ?? "a wall"}` : ""} · {(d.taps ?? []).length} tap{(d.taps ?? []).length === 1 ? "" : "s"}
          </span>
          {!readOnly && !draft && (
            <button
              type="button"
              className="link-button"
              onClick={() => setDraft({ side: m.sideIds ? m.sideIds.indexOf(d.sideId ?? "") : null, deckId: d.id, name: d.name, taps: [...(d.taps ?? [])], point: "corner:0" })}
            >
              Tap it again
            </button>
          )}
        </div>
      ))}
      {!readOnly && !draft && (
        <button type="button" className="btn-secondary" onClick={() => setDraft({ side: null, deckId: null, name: uniqueDeckName("Deck", decksOf(exterior).map((d) => d.name)), taps: [], point: "corner:0" })}>
          + A deck on these photos
        </button>
      )}
      {draft && draft.side === null && (
        <>
          <p className="field-note">Tap the wall it stands against.</p>
          <ShapePlan outline={m.corners} highlight={null} pick={(k, kind) => kind === "side" && setDraft({ ...draft, side: k })} taped={new Set()} />
        </>
      )}
      {draft && draft.side !== null && (
        <>
          <p className="field-note">
            Against {sideName(draft.side)}. Left and right as you face it from outside. Tap each on every photo that shows it: two photos place a corner.
          </p>
          <div className="option-group" role="group" aria-label="What a tap on the photo is">
            {DECK_POINTS.map((p) => (
              <button key={p.point} type="button" className={`option-btn${draft.point === p.point ? " selected" : ""}`} aria-pressed={draft.point === p.point} onClick={() => setDraft({ ...draft, point: p.point })}>
                {p.words} ({draft.taps.filter((t) => t.point === p.point).length})
              </button>
            ))}
          </div>
          <div className={styles.thumbs}>
            {placed.map((p) => (
              <button key={p.id} type="button" className={`${styles.thumb} ${p.id === photoId ? styles.thumbOn : ""}`} onClick={() => setPhotoId(p.id)}>
                {urls.get(p.id) ? <img src={urls.get(p.id)} alt={`Photo ${route.photos.indexOf(p) + 1}`} /> : <span className="field-note">waiting</span>}
                {draft.taps.some((t) => t.photo === p.id) && <span className={styles.badge}>{draft.taps.filter((t) => t.photo === p.id).length}</span>}
              </button>
            ))}
          </div>
          {photo && (
            <PhotoTaps
              url={urls.get(photo.id) ?? null}
              width={photo.width}
              height={photo.height}
              taps={[]}
              tapes={[]}
              line={null}
              mode="deck"
              selected={null}
              onTap={(x, y) => setDraft({ ...draft, taps: [...draft.taps.filter((t) => !(t.photo === photo.id && t.point === draft.point)), { photo: photo.id, point: draft.point, x, y }] })}
              onPickTap={() => {}}
              onLine={() => {}}
              deckTaps={draft.taps.filter((t) => t.photo === photo.id).map((t) => ({ x: t.x, y: t.y, label: markOf(t.point) }))}
            />
          )}
          <div className={styles.row}>
            <button type="button" className="btn-primary" disabled={draft.taps.filter((t) => t.point.startsWith("corner:")).length < 2} onClick={place}>
              Place the deck
            </button>
            <button type="button" className="btn-secondary" onClick={() => (setDraft(null), setWhy([]))}>
              Cancel
            </button>
          </div>
        </>
      )}
      {why.length > 0 && (
        <ul className="field-note">
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
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
const TRIM_OPTIONS: ["keep" | "away", string][] = [
  ["keep", "Keep it"],
  ["away", "Take it away"],
];
const DECK_OPTIONS: ["open" | "seen", string][] = [
  ["open", "Not seen yet"],
  ["seen", "Seen: as read"],
];

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
  if (row.kind === "deck") {
    // A deck read off the photos (2026-10-20): what no photo shows, kept as read with a tap; its posts counted; its depth taped.
    if (row.item === "depth") {
      return (
        <FeetField
          id={`check-${row.key}`}
          label={`${row.title}. ${row.words}`}
          value={null}
          placeholder={`${formatFeetInches(row.feet ?? 0)} from the photos`}
          readOnly={readOnly}
          onCommit={(v) => v !== null && onChange((e) => withDeckDepth(e, row.deckId, v))}
        />
      );
    }
    if (row.item === "posts") {
      return (
        <div className="exterior-row">
          <span>
            {row.title}. {row.words} How many?
          </span>
          <CountInput label={`${row.title}: how many posts`} value={row.count ?? 0} readOnly={readOnly} onCommit={(v) => onChange((e) => withDeckAnswer(e, row.deckId, row.item, v))} />
          {!readOnly && (
            <button type="button" className="link-button" onClick={() => onChange((e) => withDeckAnswer(e, row.deckId, row.item, row.count))}>
              That&rsquo;s right
            </button>
          )}
        </div>
      );
    }
    return (
      <Choice
        label={row.title}
        hint={row.words}
        value="open"
        readOnly={readOnly}
        options={DECK_OPTIONS}
        onChange={(v) => v === "seen" && onChange((e) => withDeckAnswer(e, row.deckId, row.item))}
      />
    );
  }
  if (row.kind === "trim") {
    // A surround or column the photo couldn't show all of (2026-10-17): kept as read, or taken away.
    const tside = exterior.sides.find((s) => s.id === row.sideId);
    const around = row.openingId ? tside?.openings.find((o) => o.id === row.openingId) : undefined;
    return (
      <>
        {tside && around && <OpeningCrop side={tside} opening={around} />}
        <Choice
          label={row.title}
          hint={`${row.words} As read: there.`}
          value="keep"
          readOnly={readOnly}
          options={TRIM_OPTIONS}
          onChange={(v) => onChange((e) => withTrimAnswer(e, row.sideId, { openingId: row.openingId, columnId: row.columnId }, v === "keep"))}
        />
      </>
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

/** The ± on the house's depth: its longest wall running back from the street, not shared. Null before a measure. */
function depthPm(m: PhotoRouteState["measured"], shared: number[]): number | null {
  if (!m) return null;
  const n = m.corners.length;
  const back = m.sides.filter((s) => {
    const A = m.corners[s.from] as Pt;
    const B = m.corners[(s.from + 1) % n] as Pt;
    return Math.abs(B.x - A.x) < Math.abs(B.y - A.y) && !shared.includes(s.from);
  });
  const longest = back.reduce<(typeof back)[number] | null>((a, s) => (!a || s.lengthFeet > a.lengthFeet ? s : a), null);
  return longest?.plusMinusPct ?? null;
}

/**
 * Where you stood (2026-10-20, every photo counts): a photo with one corner, or none, is placed once the user says - one
 * tap on the plan. Scrivn's best places off its window and door edges are marked to tap, or anywhere else; Measure
 * again then puts it there, on its corner's line, and holds it there loosely.
 */
function StandPicker({ drawn, measured, photo, onPick }: { drawn: Pt[]; measured: NonNullable<PhotoRouteState["measured"]>; photo: RoutePhoto; onPick: (at: [number, number]) => void }) {
  if (drawn.length < 3 || measured.corners.length !== drawn.length) return null;
  const toDrawn = planMapping(measured.corners, drawn);
  const spots = measured.doubtful?.find((d) => d.photo === photo.id)?.spots ?? [];
  const marks: { at: Pt; label: string; current?: boolean }[] = spots.map((s, i) => {
    const [x, y] = toDrawn(s.at);
    return { at: { x, y }, label: String(i + 1) };
  });
  if (photo.standAt) marks.push({ at: { x: photo.standAt[0], y: photo.standAt[1] }, label: "you", current: true });
  return (
    <div className={styles.ask}>
      <p>
        Where did you stand for this photo? Tap the plan.
        {spots.length > 0 ? ` Scrivn's best guess${spots.length === 1 ? " is" : "es are"} numbered: tap ${spots.length === 1 ? "it" : "one"}, or anywhere else.` : ""}
        {photo.standAt ? " Measure again to put it there." : ""}
      </p>
      <div className={styles.askPlan}>
        <ShapePlan outline={drawn} pick={null} highlight={null} taped={new Set()} around={0.75} spot={{ marks, pick: (p) => onPick([p.x, p.y]) }} />
      </div>
    </div>
  );
}

/** What the measure says is worth a look (lib/photoRouteSanity.ts): each names the corner or photo. Advice only. */
function WorthALook({ exterior }: { exterior: Exterior }) {
  const flags = routeSanity(exterior);
  if (flags.length === 0) return null;
  return (
    <>
      <h4 className="exterior-subhead">Worth a look</h4>
      <ul className="field-note">
        {flags.map((f) => (
          <li key={f.key}>{f.words}</li>
        ))}
      </ul>
    </>
  );
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
    shared: main.shared ?? [],
    depthTaped: main.tapes.some((t) => {
      if (t.kind !== "side") return false;
      const a = ring[t.from];
      const b = ring[(t.from + 1) % ring.length];
      return !!a && !!b && Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    }),
    depthPlusMinusPct: depthPm(m, main.shared ?? []),
  });
  // In orange: each corner and wall the list asks a photo of.
  const thin = {
    corners: new Set(cov.items.flatMap((it) => (it.corner !== undefined ? [it.corner] : []))),
    walls: new Set(cov.items.flatMap((it) => (it.wall !== undefined ? [it.wall] : []))),
  };
  const seen = cov.corners.filter((c) => c.photos.length >= 2).length;
  const both = cov.walls.filter((w) => w.both.length > 0).length;
  const toTake = cov.items.filter((it) => it.kind !== "depth-tape").length;
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
              <ShapePlan outline={ring} pick={null} highlight={null} taped={new Set()} thin={thin} shared={new Set(main.shared ?? [])} />
            </div>
            <p className="field-note">
              {m
                ? `${seen} of ${n} corners are in two photos or more, and ${both} of ${n} walls have a photo with both corners in, counting the photos the measure placed. In orange: what the list asks for.`
                : `${toTake} photo${toTake === 1 ? "" : "s"} to take, from the shape, in orange. A photo added another way counts once Measure has placed it.`}{" "}
              Advice only: Measure works any time.
            </p>
          </div>
          <ul className={styles.coverList}>
            {shown.map((it) => (
              <li key={it.key}>
                <span>{it.words}</span>
                {!readOnly && it.kind !== "depth-tape" && (
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
  shared,
  pickCorners = true,
  around,
  spot,
}: {
  outline: Pt[];
  pick: ((k: number, kind: "corner" | "side") => void) | null;
  highlight: number | null;
  taped: Set<number>;
  /** What the photos cover thinly (lib/photoRouteCoverage.ts), in orange. */
  thin?: { corners: Set<number>; walls: Set<number> };
  /** The walls shared with the neighbours, in grey. */
  shared?: Set<number>;
  /** Whether a corner is being picked (orange, tappable); otherwise only the sides take taps. */
  pickCorners?: boolean;
  /** The plan round the house as well, this much of its size each way (where photos are taken from). */
  around?: number;
  /** A spot to tap anywhere on the plan (where you stood), with marks to show: Scrivn's best places, the one said. */
  spot?: { marks: { at: Pt; label: string; current?: boolean }[]; pick: (p: Pt) => void };
}) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const pad = span * (around ?? 0.12);
  // Dots and words sized to the view, not the house: the plan round the house (where you stood) draws them as large.
  const size = (span + 2 * pad) / 1.24;
  const svgRef = useRef<SVGSVGElement | null>(null);
  // A tap anywhere: the plan point under it (a mark tapped near enough is taken whole).
  const onSpot = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!spot || !svg || !ctm) return;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const at = { x: q.x + x0 - pad, y: y1 + pad - q.y };
    const near = spot.marks.find((m) => !m.current && Math.hypot(m.at.x - at.x, m.at.y - at.y) < size * 0.06);
    spot.pick(near ? near.at : at);
  };
  const W = x1 - x0 + 2 * pad;
  const H = y1 - y0 + 2 * pad;
  // Plan y is up; the SVG's is down.
  const P = (p: Pt) => ({ x: p.x - x0 + pad, y: y1 - p.y + pad });
  const r = size * 0.035;
  const n = outline.length;
  return (
    <svg
      ref={svgRef}
      className={styles.plan}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="The house's shape, its corners numbered"
      onClick={spot ? onSpot : undefined}
      style={spot ? { cursor: "crosshair" } : undefined}
    >
      <polygon points={outline.map((p) => `${P(p).x},${P(p).y}`).join(" ")} fill="rgba(8,145,178,0.08)" stroke="#0891b2" strokeWidth={size * 0.008} />
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
              stroke={highlight === i || thin?.walls.has(i) ? "#ea580c" : taped.has(i) ? "#15803d" : shared?.has(i) ? "#a8a29e" : "transparent"}
              strokeWidth={size * 0.02}
              strokeDasharray={thin?.walls.has(i) && highlight !== i ? `${size * 0.03} ${size * 0.02}` : undefined}
            />
            {pick && <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="transparent" strokeWidth={size * 0.06} style={{ cursor: "pointer" }} onClick={() => pick(i, "side")} />}
            {taped.has(i) && (
              <text x={mid.x} y={mid.y} fontSize={size * 0.04} textAnchor="middle" fill="#15803d">
                taped
              </text>
            )}
            {shared?.has(i) && !taped.has(i) && (
              <text x={mid.x} y={mid.y} fontSize={size * 0.04} textAnchor="middle" fill="#78716c" stroke="#fff" strokeWidth={size * 0.006} paintOrder="stroke">
                shared
              </text>
            )}
          </g>
        );
      })}
      {outline.map((p, i) => {
        const q = P(p);
        return (
          <g key={`c${i}`} style={{ cursor: pick && pickCorners ? "pointer" : undefined }} onClick={() => pickCorners && pick?.(i, "corner")}>
            <circle cx={q.x} cy={q.y} r={r} fill={(pick && pickCorners) || thin?.corners.has(i) ? "#ea580c" : "#0891b2"} />
            <text x={q.x} y={q.y + r * 0.4} fontSize={r * 1.15} textAnchor="middle" fill="#fff">
              {i + 1}
            </text>
          </g>
        );
      })}
      {spot?.marks.map((m, i) => {
        const q = P(m.at);
        return (
          <g key={`spot${i}`} pointerEvents="none">
            <circle cx={q.x} cy={q.y} r={r * 1.3} fill={m.current ? "#7c3aed" : "#ffffff"} stroke={m.current ? "#7c3aed" : "#ea580c"} strokeWidth={size * 0.006} />
            <text x={q.x} y={q.y + r * 0.45} fontSize={r * (m.current ? 0.9 : 1.3)} textAnchor="middle" fill={m.current ? "#ffffff" : "#ea580c"}>
              {m.label}
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
  deckTaps = [],
}: {
  url: string | null;
  width: number;
  height: number;
  taps: { c: CornerTap; i: number }[];
  tapes: Extract<RouteTape, { kind: "line" }>[];
  line: { a: [number, number]; b: [number, number] } | null;
  mode: "corners" | "ends" | "tape" | "wall" | "deck" | null;
  selected: number | null;
  onTap: (x: number, y: number) => void;
  onPickTap: (i: number) => void;
  onLine: (a: [number, number], b: [number, number]) => void;
  /** A deck's taps on this photo (2026-10-20): each with its short label. */
  deckTaps?: { x: number; y: number; label: string }[];
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
          if ((mode === "corners" || mode === "ends" || mode === "deck") && moved < 10) onTap(...toPhoto(e));
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
        {deckTaps.map((t, k) => (
          <g key={`deck-${k}`} pointerEvents="none">
            <rect x={t.x - r} y={t.y - r} width={r * 2} height={r * 2} fill="#b45309" stroke="#fff" strokeWidth={r / 5} />
            <text x={t.x} y={t.y + r * 0.42} fontSize={r * 1.1} textAnchor="middle" fill="#fff">
              {t.label}
            </text>
          </g>
        ))}
        {taps.map(({ c, i }) => (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPickTap(i);
            }}
          >
            <line
              x1={c.x}
              y1={c.party ? 0 : c.y - r * 6}
              x2={c.x}
              y2={c.y}
              stroke={selected === i ? "#ea580c" : c.party ? "#7c3aed" : "#0891b2"}
              strokeWidth={r / 4}
              strokeDasharray={c.proposed ? `${r / 1.5} ${r / 2.5}` : undefined}
            />
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
  const [feet, setFeet] = useState<number | null>(null);
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
        <span>Its length </span>
        <FeetInchesInput label="Its length" onChange={setFeet} />
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
  const [feet, setFeet] = useState<number | null>(null);
  return (
    <div className={`${styles.card} ${styles.row}`}>
      <span>The side&rsquo;s length, corner to corner </span>
      <FeetInchesInput label="The side's length" autoFocus onChange={setFeet} />
      <button type="button" className="btn-primary" disabled={feet === null || !(feet > 0)} onClick={() => feet && onDone(feet)}>
        Add the tape
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

