"use client";

/**
 * Drop a sketch (2026-11-05): a photo of a hand-drawn floor sketch made into a Scrivn sketch at its real size. Anyone can
 * trace one (tap the corners, type the numbers; no AI, nothing spent). A signed-in user can have Scrivn read it instead
 * (/api/hand-sketch/read), and check that reading in the same tracer. Either way the build is lib/handSketch.ts, the
 * questions it asks are answered in the review, and the result can be fixed in Scrivn's sketch editor, made into a
 * to-scale PDF and JPG, or added to a claim (lib/handSketchClaim.ts; the claim page adds the rooms itself).
 *
 * Kept in this browser as it goes, so a reload or a sign-in in the middle loses nothing. The photo never leaves the
 * browser unless Scrivn is asked to read it, and is not kept anywhere once it has been.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buildFromRead, type HandSketchQuestion, type HandSketchRead } from "@/lib/handSketch";
import { newHandoffToken, writeHandoff } from "@/lib/handSketchClaim";
import { drawSample } from "@/lib/handSketchSample";
import { answerQuestion, emptyTrace, openQuestions, readToTrace, traceToRead, type HandSketchAnswer, type TraceState } from "@/lib/handSketchTrace";
import { decodeImage, drawScaled } from "@/lib/photoImage";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { type Sketch, emptySketch } from "@/lib/sketch";
import { Review } from "./Review";
import { Tracer, type TracePhoto } from "./Tracer";
import styles from "./handSketch.module.css";

const SketchEditor = dynamic(() => import("@/components/sketch/SketchEditor").then((m) => m.SketchEditor), { ssr: false });

/** The long side a photo is kept and read at: the model's own working size, and what its corners are measured in. */
const PHOTO_EDGE = 1400;
const DRAFT_KEY = "scrivn.dropASketch.draft.v1";

type Stage = "start" | "trace" | "review" | "edit";

interface Draft {
  stage: Stage;
  photo: TracePhoto;
  trace: TraceState;
  read: HandSketchRead | null;
  dismissed: string[];
  edited: Sketch | null;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.photo?.url && d.trace ? d : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Full or refused: the work stays on screen, it just would not survive a reload.
  }
}

/** The review's read written back onto the trace, so going back to the photo keeps the answers. */
function traceWithRead(trace: TraceState, read: HandSketchRead): TraceState {
  let k = 0;
  return {
    ...trace,
    rotate: read.rotate,
    rooms: trace.rooms.map((r) => {
      if (!r.closed) return r;
      const got = read.rooms[k++];
      if (!got) return r;
      return { ...r, name: got.name, ceiling: got.ceiling, lengths: got.walls.map((w) => w.length), openings: got.openings, items: got.items, guess: got.guess };
    }),
  };
}

export function DropASketch({ signedIn, canRead, dev }: { signedIn: boolean; canRead: boolean; dev: boolean }) {
  const [stage, setStage] = useState<Stage>("start");
  const [photo, setPhoto] = useState<TracePhoto | null>(null);
  const [trace, setTrace] = useState<TraceState | null>(null);
  const [read, setRead] = useState<HandSketchRead | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [edited, setEdited] = useState<Sketch | null>(null);
  const [editing, setEditing] = useState<Sketch>(emptySketch());
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
  const [saved, setSaved] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [claims, setClaims] = useState<{ id: string; label: string }[] | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSaved(loadDraft());
  }, []);

  // Kept as it goes (a moment after each change), and cleared on Start again.
  useEffect(() => {
    if (!photo || !trace) return;
    const t = setTimeout(() => saveDraft({ stage: stage === "edit" ? "review" : stage, photo, trace, read, dismissed, edited }), 500);
    return () => clearTimeout(t);
  }, [stage, photo, trace, read, dismissed, edited]);

  // Nothing behind a full-screen step scrolls.
  useEffect(() => {
    if (stage === "start") return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [stage]);

  const build = useMemo(() => (read ? buildFromRead(read) : null), [read]);
  const sketch: Sketch = useMemo(() => edited ?? { ...emptySketch(), rooms: build?.rooms ?? [] }, [edited, build]);
  const questions: HandSketchQuestion[] = useMemo(() => (build && !edited ? openQuestions(build.questions, dismissed) : []), [build, edited, dismissed]);

  const begin = (p: TracePhoto) => {
    setPhoto(p);
    setTrace(emptyTrace(p.width, p.height));
    setRead(null);
    setDismissed([]);
    setEdited(null);
    setError(null);
  };

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("Getting the photo ready…");
    try {
      const canvas = drawScaled(await decodeImage(file), PHOTO_EDGE);
      begin({ url: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height });
    } catch {
      setError("That photo could not be opened. Try another, or take one.");
    } finally {
      setBusy(null);
    }
  };

  const readIt = async () => {
    if (!photo) return;
    setError(null);
    setBusy("Scrivn is reading your sketch…");
    try {
      const res = await fetch("/api/hand-sketch/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: photo.url.split(",")[1] ?? "", width: photo.width, height: photo.height }),
      });
      const body = (await res.json().catch(() => ({}))) as { read?: HandSketchRead; error?: string };
      if (!res.ok || !body.read) {
        setError(res.status === 401 ? "Sign in to have Scrivn read it, or trace it yourself." : (body.error ?? "Scrivn could not read the sketch. You can trace it yourself."));
        return;
      }
      setTrace(readToTrace(body.read, { width: photo.width, height: photo.height }));
      setStage("trace");
    } catch {
      setError("Scrivn could not be reached. You can trace the sketch yourself.");
    } finally {
      setBusy(null);
    }
  };

  const toReview = useCallback(() => {
    if (!trace) return;
    setRead(traceToRead(trace));
    setEdited(null);
    setStage("review");
  }, [trace]);

  const answer = (q: HandSketchQuestion, a: HandSketchAnswer) => {
    if (!read || !trace) return;
    const next = answerQuestion(read, q, a, dismissed);
    setRead(next.read);
    setDismissed(next.dismissed);
    setTrace(traceWithRead(trace, next.read));
  };

  const turn = () => {
    if (!read || !trace) return;
    const rotate = (((read.rotate + 90) % 360) as 0 | 90 | 180 | 270);
    setRead({ ...read, rotate });
    setTrace({ ...trace, rotate });
  };

  const backToPhoto = () => {
    if (edited && !window.confirm("Going back to the photo replaces the changes made in the editor. Go back?")) return;
    if (trace && read) setTrace(traceWithRead(trace, read));
    setEdited(null);
    setStage("trace");
  };

  const startAgain = () => {
    if ((trace?.rooms.length ?? 0) > 0 && !window.confirm("Start again with a new photo? This sketch will be cleared.")) return;
    saveDraft(null);
    setSaved(null);
    setPhoto(null);
    setTrace(null);
    setRead(null);
    setEdited(null);
    setDismissed([]);
    setStage("start");
  };

  const resume = (d: Draft) => {
    setPhoto(d.photo);
    setTrace(d.trace);
    setRead(d.read);
    setDismissed(d.dismissed ?? []);
    setEdited(d.edited);
    setStage(d.stage === "edit" ? "review" : d.stage);
    setSaved(null);
  };

  const openClaims = async () => {
    setError(null);
    setClaims([]);
    try {
      const res = await fetch("/api/claims");
      const body = (await res.json()) as { claims?: { claims?: { id: string; customerName: string; jobNumber: string; address: string }[] } };
      const list = body.claims?.claims ?? [];
      setClaims(list.slice(0, 40).map((c) => ({ id: c.id, label: [c.jobNumber, c.customerName, c.address].filter(Boolean).join(" · ") || "Untitled claim" })));
    } catch {
      setError("Your claims could not be loaded. You can still start a new claim with this sketch.");
    }
  };

  const toClaim = (claimId: string | null) => {
    const token = newHandoffToken();
    const ok = writeHandoff({ token, createdAt: new Date().toISOString(), claimId, sketch: { rooms: sketch.rooms, freeWalls: sketch.freeWalls, levels: sketch.levels, levelNames: sketch.levelNames } });
    if (!ok) {
      setError("This browser would not keep the sketch to hand it to the claim. Make the PDF instead, or try again.");
      return;
    }
    window.location.assign(`/claim?${claimId ? `id=${encodeURIComponent(claimId)}&` : ""}handSketch=${token}`);
  };

  const layer = (() => {
    if (!mounted || !photo || !trace) return null;
    if (stage === "trace") return <Tracer photo={photo} trace={trace} onChange={setTrace} onBack={() => setStage(read ? "review" : "start")} onDone={toReview} />;
    if (stage === "review" && read && build)
      return (
        <>
          <Review
            photo={photo}
            read={read}
            build={build}
            sketch={sketch}
            edited={!!edited}
            questions={questions}
            signedIn={signedIn}
            onAnswer={answer}
            onTurn={turn}
            onEdit={() => {
              setEditing(sketch);
              setStage("edit");
            }}
            onBack={backToPhoto}
            onAddToClaim={openClaims}
          />
          {claims ? (
            <div className={styles.sheet} role="dialog" aria-label="Add to a claim">
              <p className={styles.say}>
                <strong>Add the rooms to which claim?</strong> They are added beside the claim&apos;s own rooms; nothing is replaced.
              </p>
              <button type="button" className={`btn-primary ${styles.claimRow}`} onClick={() => toClaim(null)}>
                A new claim
              </button>
              {claims.map((c) => (
                <button key={c.id} type="button" className={`btn-secondary ${styles.claimRow}`} onClick={() => toClaim(c.id)}>
                  {c.label}
                </button>
              ))}
              <button type="button" className="link-button" onClick={() => setClaims(null)}>
                Cancel
              </button>
            </div>
          ) : null}
        </>
      );
    if (stage === "edit")
      return (
        <div className={styles.layer} role="dialog" aria-label="Edit your sketch">
          <SketchEditor
            sketch={editing}
            knownRoomNames={[]}
            moisture={moisture}
            onChange={setEditing}
            onMoistureChange={setMoisture}
            onClose={() => {
              setEdited(editing);
              setStage("review");
            }}
            standalone={{ title: "Your sketch" }}
          />
        </div>
      );
    return null;
  })();

  return (
    <div className={styles.landing}>
      {saved && !photo ? (
        <div className={styles.drop}>
          <p className={styles.say}>
            <strong>You have a sketch on the go.</strong>
          </p>
          <div className={styles.buttons}>
            <button type="button" className="btn-primary" onClick={() => resume(saved)}>
              Carry on with it
            </button>
            <button type="button" className="btn-secondary" onClick={startAgain}>
              Start a new one
            </button>
          </div>
        </div>
      ) : null}

      {!photo ? (
        <div
          className={`${styles.drop} ${dragOver ? styles.dropOn : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void takeFile(e.dataTransfer.files[0]);
          }}
        >
          <p className={styles.say}>
            <strong>A photo of your sketch</strong>, taken straight on, with the numbers you wrote on the walls in it.
          </p>
          <div className={styles.buttons}>
            <label className="btn-primary">
              Take a photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void takeFile(e.target.files?.[0])} />
            </label>
            <label className="btn-secondary">
              Choose a photo
              <input type="file" accept="image/*" hidden onChange={(e) => void takeFile(e.target.files?.[0])} />
            </label>
            {dev ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const s = drawSample();
                  begin({ url: s.dataUrl, width: s.width, height: s.height });
                }}
              >
                Use the sample sketch
              </button>
            ) : null}
          </div>
          <p className={styles.note}>Or drop the photo here.</p>
        </div>
      ) : (
        <div className={styles.drop}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a photo held in the page */}
          <img src={photo.url} alt="Your sketch" className={styles.preview} />
          <div className={styles.buttons}>
            <button type="button" className="btn-primary" onClick={() => setStage(read ? "review" : "trace")}>
              {read ? "Back to your sketch" : "Trace it"}
            </button>
            {!read ? (
              canRead ? (
                <button type="button" className="btn-secondary" disabled={!!busy} onClick={readIt}>
                  Read it for me
                </button>
              ) : signedIn ? null : (
                <a className="btn-secondary" href="/login?next=/drop-a-sketch">
                  Sign in to have Scrivn read it
                </a>
              )
            ) : null}
            <button type="button" className="link-button" onClick={startAgain}>
              Use another photo
            </button>
          </div>
          <p className={styles.note}>
            Trace it: tap each room&apos;s corners and type the numbers, free and nothing sent anywhere.
            {canRead ? " Read it for me: Scrivn reads the corners and numbers for you to check." : ""}
          </p>
        </div>
      )}
      {busy ? (
        <p className={styles.note} role="status">
          {busy}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {layer ? createPortal(layer, document.body) : null}
    </div>
  );
}
