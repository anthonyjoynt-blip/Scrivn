"use client";

import { useEffect, useState } from "react";
import { connection, onReconnect } from "@/lib/connectivity";
import { newClaimId, onDeviceChange } from "@/lib/deviceClaims";
import { type Exterior, notPhotographedSides, withUnseenSaid } from "@/lib/exterior";
import { buildingKeyOf, checkTeamResult, type ExteriorRequestView, isOpenRequest, MAX_REQUEST_NOTE_CHARS, withTeamMeasure } from "@/lib/exteriorRequests";
import {
  knownRequests,
  markApplied,
  onTeamChange,
  photosStillToUpload,
  refreshRequests,
  sendToTeam,
  sendWaitingRequests,
  type WaitingRequest,
  waitingRequests,
  withdrawRequest,
} from "@/lib/exteriorRequestQueue";
import { useExteriorPhotos } from "./exteriorPhotoAccess";
import { useExteriorSubject } from "./exteriorSubject";
import { newWalk, walkMeasures } from "@/lib/photoRouteWalk";
import styles from "./TeamMeasure.module.css";
import { type UnseenSaid, UnseenWallAsk } from "./UnseenWalls";

/**
 * Send to Scrivn team (2026-10-17, lib/exteriorRequests.ts), on the Exterior: the button beside Measure on the
 * photo route, and one line wherever the house or building is open while it is with us -
 *
 *   "Sent to the Scrivn team – it'll show here when it's measured."   (and how many photos are still to upload)
 *   "Measured – Use it"                                                 Use it puts it in, through the claim's save
 *
 * each with Withdraw. Nothing waits on any of it: the tester can measure it themselves meanwhile, and Use it is
 * one tap whenever they like.
 */

/** Puts a returned exterior in, from the exterior as it is now (undefined: none, or removed since it was sent). */
export type ApplyTeam = (f: (prev: Exterior | undefined) => Exterior) => void;

type Shown =
  | { kind: "waiting"; id: string; photoIds: string[]; refused: string | null }
  | { kind: "sent"; id: string }
  | { kind: "ready"; view: ExteriorRequestView };

/** What to show for one building: a send still on this phone first, else Scrivn's newest open request for it. */
function shownFor(building: string, waiting: WaitingRequest[], known: ExteriorRequestView[] | null): Shown | null {
  const send = waiting.filter((w) => w.kind === "send" && w.input?.building === building).sort((a, b) => b.at - a.at)[0];
  if (send) return { kind: "waiting", id: send.id, photoIds: send.input?.photoIds ?? [], refused: send.refused ?? null };
  // Withdrawn or used here and not yet told to Scrivn: gone from the screen all the same.
  const acted = new Set(waiting.filter((w) => w.kind !== "send").map((w) => w.id));
  const open = (known ?? []).find((r) => r.building === building && isOpenRequest(r.status) && !acted.has(r.id));
  if (!open) return null;
  return open.status === "ready" && open.result ? { kind: "ready", view: open } : { kind: "sent", id: open.id };
}

/** The claim's requests, as this phone and Scrivn know them, asked again while the Exterior is open. */
function useTeam(claimId: string | null): { waiting: WaitingRequest[]; known: ExteriorRequestView[] | null } {
  const [, setTick] = useState(0);
  useEffect(() => {
    // A subscription, not a state updater (test:sketch's stateRules).
    const bump = () => setTick((n) => n + 1);
    return onTeamChange(bump);
  }, []);
  useEffect(() => {
    if (!claimId) return;
    void refreshRequests(claimId);
    const again = () => {
      if (document.visibilityState === "visible") void refreshRequests(claimId);
    };
    const timer = setInterval(again, 120_000);
    document.addEventListener("visibilitychange", again);
    const backOnline = () => void sendWaitingRequests().then(() => refreshRequests(claimId, { force: true }));
    const offReconnect = onReconnect(backOnline);
    // A photo uploaded: a send waiting for it may go now.
    const photosMoved = () => {
      if (waitingRequests(claimId).some((w) => w.kind === "send")) void sendWaitingRequests();
    };
    const offDevice = onDeviceChange(photosMoved);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
      offReconnect();
      offDevice();
    };
  }, [claimId]);
  return { waiting: claimId ? waitingRequests(claimId) : [], known: claimId ? knownRequests(claimId) : null };
}

/** How many of a waiting send's photos are still on this phone, asked again as they upload. */
function useStillToUpload(ids: string[] | null): number {
  const [n, setN] = useState(0);
  const key = ids?.join(",") ?? "";
  useEffect(() => {
    if (!ids) return;
    let live = true;
    const count = () => {
      void photosStillToUpload(ids).then((c) => {
        if (live) setN(c);
      });
    };
    count();
    const off = onDeviceChange(count);
    return () => {
      live = false;
      off();
    };
    // The ids stand for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ids ? n : 0;
}

/** The line itself, for the building the editor is on. Nothing while nothing is with us. */
export function TeamMeasureStatus({ exterior, building, readOnly, apply, onUsed }: { exterior: Exterior | undefined; building: string; readOnly: boolean; apply: ApplyTeam; onUsed?: () => void }) {
  const access = useExteriorPhotos();
  const claimId = access?.claimId ?? null;
  const { waiting, known } = useTeam(claimId);
  const shown = shownFor(building, waiting, known);
  const still = useStillToUpload(shown?.kind === "waiting" ? shown.photoIds : null);
  /** What the tester says is on each wall no photo faces, by side id: put in as the measure is used. */
  const [said, setSaid] = useState<Record<string, UnseenSaid>>({});
  if (!shown || !claimId) return null;

  const withdraw = (id: string) => withdrawRequest(claimId, id);
  const withdrawLink = (id: string) =>
    readOnly ? null : (
      <button type="button" className="link-button" onClick={() => withdraw(id)}>
        Withdraw
      </button>
    );

  if (shown.kind === "waiting" && shown.refused) {
    return (
      <div className={`${styles.status} ${styles.refused}`} role="status">
        <p>Scrivn couldn&rsquo;t take it: {shown.refused}</p>
        {withdrawLink(shown.id)}
      </div>
    );
  }
  if (shown.kind === "waiting" || shown.kind === "sent") {
    const id = shown.id;
    const more =
      shown.kind === "waiting" && still > 0
        ? ` ${still} photo${still === 1 ? " is" : "s are"} still to upload: ${still === 1 ? "it goes" : "they go"} when there's signal.`
        : shown.kind === "waiting" && connection() === "offline"
          ? " It goes when there's signal."
          : "";
    return (
      <div className={styles.status} role="status">
        <p>
          Sent to the Scrivn team &ndash; it&rsquo;ll show here when it&rsquo;s measured.{more}
        </p>
        {withdrawLink(id)}
      </div>
    );
  }

  const view = shown.view;
  const checked = checkTeamResult(view.result);
  if (!checked.ok) {
    return (
      <div className={`${styles.status} ${styles.refused}`} role="status">
        <p>The Scrivn team&rsquo;s measurement can&rsquo;t be opened here ({checked.error}). Withdraw it and send it again.</p>
        {withdrawLink(view.id)}
      </div>
    );
  }
  const result = checked.value;
  // The walls no photo faces (2026-10-21): only the tester can say what's on them, so they're asked here, before it's
  // used - nothing else is: what the photos show is ours to read.
  const unseen = notPhotographedSides(withTeamMeasure(undefined, result, view.readyAt ?? ""));
  const use = () => {
    const mine = (exterior?.sides.length ?? 0) > 0;
    if (mine && !window.confirm("Use the Scrivn team's measurements? They replace the sides measured here. Your photos and tapes stay.")) return;
    const at = new Date().toISOString();
    apply((prev) => Object.entries(said).reduce((e, [sideId, s]) => (s ? withUnseenSaid(e, sideId, s) : e), withTeamMeasure(prev, result, at)));
    markApplied(claimId, view.id);
    access?.onCheckpoint?.();
    onUsed?.();
  };
  return (
    <div className={`${styles.status} ${styles.ready}`} role="status">
      <p>Measured &ndash;</p>
      {unseen.length > 0 && !readOnly && (
        <div className={styles.unseen}>
          <p>
            {unseen.length === 1 ? "One wall had no photo" : `${unseen.length} walls had no photo`}, so only you can say what&rsquo;s on {unseen.length === 1 ? "it" : "them"}. Answer what you
            know, then Use it; anything left is marked &ldquo;not photographed&rdquo;.
          </p>
          {unseen.map((s) => (
            <UnseenWallAsk key={s.id} side={s} said={said[s.id] ?? null} readOnly={readOnly} onSay={(x) => setSaid((m) => ({ ...m, [s.id]: x }))} />
          ))}
        </div>
      )}
      {readOnly ? (
        <p>tap &ldquo;View only&rdquo; at the top to unlock, then Use it.</p>
      ) : (
        <>
          <button type="button" className="btn-primary" onClick={use}>
            Use it
          </button>
          {withdrawLink(view.id)}
        </>
      )}
    </div>
  );
}

/**
 * "Send to Scrivn team to measure", beside Measure on the photo route. With one already with us for this building,
 * the line saying so instead.
 */
export function SendToTeam({ exterior, readOnly, apply, primary = false }: { exterior: Exterior; readOnly: boolean; apply: ApplyTeam; /** The main way on (the end of the walk round the house). */ primary?: boolean }) {
  const access = useExteriorPhotos();
  const { name, the } = useExteriorSubject();
  const building = buildingKeyOf(exterior);
  const { waiting, known } = useTeam(access?.claimId ?? null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (readOnly || !access) return null;
  if (shownFor(building, waiting, known)) return <TeamMeasureStatus exterior={exterior} building={building} readOnly={readOnly} apply={apply} />;

  // The route's photos, and the walk's close-ups of a tape (2026-10-22): the number and its ends read off them.
  const tapeIds = walkMeasures(exterior.photoRoute?.walk ?? newWalk()).flatMap(({ m }) => (m.tapePhoto ? [m.tapePhoto] : []));
  const photoIds = [...new Set([...(exterior.photoRoute?.photos ?? []).map((p) => p.id), ...tapeIds])];
  if (!open) {
    return (
      <button type="button" className={primary ? "btn-primary" : "btn-secondary"} disabled={photoIds.length === 0} title={photoIds.length === 0 ? "Add the photos first" : undefined} onClick={() => setOpen(true)}>
        Send to Scrivn team to measure
      </button>
    );
  }
  const send = () => {
    const claimId = access.claimIdNow();
    sendToTeam(claimId, { id: newClaimId(), building, buildingName: name ?? "", photoIds, route: exterior.photoRoute ?? null, note: note.trim().slice(0, MAX_REQUEST_NOTE_CHARS) });
    // The claim's save first: Scrivn takes a request only for photos its claim lists.
    access.onCheckpoint?.();
    setOpen(false);
    setNote("");
  };
  return (
    <div className={styles.form}>
      <p>
        The Scrivn team measures {the} from these {photoIds.length} photo{photoIds.length === 1 ? "" : "s"} and your measurements, and puts it back here for you to use. Our staff see this claim&rsquo;s
        exterior photos, measurements and note, nothing else.
      </p>
      <label>
        Anything we should know? (optional)
        <textarea value={note} maxLength={MAX_REQUEST_NOTE_CHARS} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the side yard is too tight for a photo" />
      </label>
      <div className={styles.row}>
        <button type="button" className="btn-primary" onClick={send}>
          Send
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
