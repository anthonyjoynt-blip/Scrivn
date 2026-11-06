"use client";

/**
 * The sketch as built from the photo (2026-11-05): the photo beside the plan exactly as the PDF will draw it, the build's
 * questions one at a time (the wall a question is about lit on the photo), the rooms' sizes, and what to do with it: fix
 * it in the editor, make the PDF and JPG, or add it to a claim.
 */
import { useEffect, useRef, useState } from "react";
import { FeetInchesInput } from "@/components/sketch/FeetInchesInput";
import { NAMES, feetInches, type DrawnPoint, type HandSketchBuild, type HandSketchQuestion, type HandSketchRead } from "@/lib/handSketch";
import { lengthText, type HandSketchAnswer } from "@/lib/handSketchTrace";
import { quantityRows } from "@/lib/scanEditor";
import type { Sketch } from "@/lib/sketch";
import type { TracePhoto } from "./Tracer";
import styles from "./handSketch.module.css";

const ROOM_NAMES = [...new Set(Object.values(NAMES))];

interface MadeFile {
  name: string;
  mime: string;
  blob: Blob;
}

export function Review({
  photo,
  read,
  build,
  sketch,
  edited,
  questions,
  signedIn,
  onAnswer,
  onTurn,
  onEdit,
  onBack,
  onAddToClaim,
}: {
  photo: TracePhoto;
  read: HandSketchRead;
  build: HandSketchBuild;
  sketch: Sketch;
  edited: boolean;
  questions: HandSketchQuestion[];
  signedIn: boolean;
  onAnswer: (q: HandSketchQuestion, a: HandSketchAnswer) => void;
  onTurn: () => void;
  onEdit: () => void;
  onBack: () => void;
  onAddToClaim: () => void;
}) {
  const [show, setShow] = useState<"photo" | "plan">("plan");
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const [files, setFiles] = useState<MadeFile[] | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  // The plan as the PDF draws it, redrawn when the sketch changes.
  useEffect(() => {
    let live = true;
    setFiles(null);
    (async () => {
      try {
        const [{ planHost }, { storeyExtentFt }] = await Promise.all([import("@/components/sketch/planHost"), import("@/lib/scanEditorPdf")]);
        const extent = storeyExtentFt(sketch, 0);
        if (!extent) return setPlanUrl(null);
        const width = Math.max(260, (box.current?.clientWidth ?? 340) - 24);
        const upf = Math.max(10, Math.min(60, (width - 48) / Math.max(extent.widthFt, 1), 560 / Math.max(extent.heightFt, 1)));
        const pic = await planHost(sketch).plan(0, upf, 24, 2);
        if (live) setPlanUrl(pic?.dataUrl ?? null);
      } catch (err) {
        if (live) setError(`The plan could not be drawn: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [sketch]);

  const q = questions[0];
  const rows = quantityRows(sketch, 0).rows;

  const make = async () => {
    setMaking(true);
    setError(null);
    try {
      const [{ planHost }, { buildPlanFiles }] = await Promise.all([import("@/components/sketch/planHost"), import("@/lib/scanEditorPdf")]);
      const title = sketch.rooms.length === 1 ? (sketch.rooms[0]?.name ?? "Floor plan") : "Floor plan";
      const made = await buildPlanFiles(sketch, { title, subtitle: new Date().toLocaleDateString(), jpg: true, madeBy: "drawn from a sketch at scrivn.ca" }, planHost(sketch));
      setFiles(
        made.files.map((f) => {
          const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
          return { name: f.name === "plan.pdf" ? `${title}.pdf` : f.name.replace(/^level/, title.replace(/\s+/g, "-")), mime: f.mime, blob: new Blob([bytes], { type: f.mime }) };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMaking(false);
    }
  };

  const save = (f: MadeFile) => {
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const shareAll = async () => {
    if (!files) return;
    const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.mime }));
    try {
      await navigator.share({ files: asFiles, title: "Floor plan" });
    } catch {
      // Cancelled, or the share sheet refused: the Download buttons are still there.
    }
  };
  const canShare = typeof navigator !== "undefined" && !!files && typeof navigator.canShare === "function" && navigator.canShare({ files: files.map((f) => new File([f.blob], f.name, { type: f.mime })) });

  // The wall a question is about, lit on the photo; a door's two walls numbered.
  const lit: { a: DrawnPoint; b: DrawnPoint; label?: string }[] = [];
  const wallOf = (room: number, wall: number) => {
    const cs = read.rooms[room]?.corners ?? [];
    return { a: cs[wall] as DrawnPoint, b: cs[(wall + 1) % cs.length] as DrawnPoint };
  };
  if (q?.kind === "wallDiffers" || q?.kind === "tapeWall") lit.push(wallOf(q.room, q.wall));
  if (q?.kind === "doorWall") q.walls.forEach((w, i) => lit.push({ ...wallOf(q.room, w), label: String(i + 1) }));
  if (q?.kind === "isOpening") {
    const o = read.rooms[q.room]?.openings[q.opening];
    if (o) lit.push(wallOf(q.room, o.wall));
  }
  const u = photo.width / 360;
  const builtLength = (room: number, wall: number) => build.walls.find((w) => w.room === room && w.wall === wall)?.inches ?? 0;

  return (
    <div className={styles.layer} role="dialog" aria-label="Your sketch">
      <div className={styles.bar}>
        <button type="button" className="btn-secondary" onClick={onBack}>
          Fix on photo
        </button>
        <p className={styles.barTitle}>Your sketch</p>
        <button type="button" className="btn-primary" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className={styles.review} ref={box}>
        <div className={`${styles.row} ${styles.viewToggle}`} role="group" aria-label="Show">
          <button type="button" className={`option-btn${show === "plan" ? " selected" : ""}`} aria-pressed={show === "plan"} onClick={() => setShow("plan")}>
            Plan
          </button>
          <button type="button" className={`option-btn${show === "photo" ? " selected" : ""}`} aria-pressed={show === "photo"} onClick={() => setShow("photo")}>
            Photo
          </button>
          <button type="button" className="btn-secondary" onClick={onTurn} disabled={edited}>
            Turn plan
          </button>
        </div>
        <div className={styles.views}>
          <div className={`${styles.view} ${show === "photo" ? "" : styles.hidden}`}>
            <div style={{ position: "relative", width: "100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a photo held in the page, not a file to optimise */}
              <img src={photo.url} alt="Your sketch" style={{ width: "100%", height: "auto", display: "block" }} />
              <svg viewBox={`0 0 ${photo.width} ${photo.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
                {lit.map((l, i) =>
                  l.a && l.b ? (
                    <g key={i}>
                      <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#ea580c" strokeWidth={6 * u} strokeLinecap="round" opacity={0.85} />
                      {l.label ? (
                        <text x={(l.a.x + l.b.x) / 2} y={(l.a.y + l.b.y) / 2 - 8 * u} fontSize={22 * u} fontWeight={700} fill="#ffffff" stroke="#9a3412" strokeWidth={4 * u} paintOrder="stroke" textAnchor="middle">
                          {l.label}
                        </text>
                      ) : null}
                    </g>
                  ) : null,
                )}
              </svg>
            </div>
          </div>
          <div className={`${styles.view} ${show === "plan" ? "" : styles.hidden}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn in the page */}
            {planUrl ? <img src={planUrl} alt="The plan built from your sketch" /> : <p className={styles.note}>Drawing the plan…</p>}
          </div>
        </div>

        {edited ? (
          <p className={styles.note}>Changed in the editor. Going back to the photo starts again from it.</p>
        ) : q ? (
          <div className={styles.question}>
            <p className={styles.questionHead}>
              Question 1 of {questions.length}
              {read.rooms[q.room] ? ` · ${read.rooms[q.room]?.name ?? "this room"}` : ""}
            </p>
            <Question key={JSON.stringify(q)} q={q} read={read} builtLength={builtLength} onAnswer={(a) => onAnswer(q, a)} onSeePhoto={() => setShow("photo")} />
          </div>
        ) : (
          <p className={styles.note}>Nothing left to ask. Check the sizes, then make the PDF or add it to a claim.</p>
        )}

        <table className={styles.rooms}>
          <thead>
            <tr>
              <th>Room</th>
              <th>Size</th>
              <th>Floor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>{r.size}</td>
                <td>{r.f}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          {files ? (
            <>
              {canShare ? (
                <button type="button" className="btn-primary" onClick={shareAll}>
                  Share
                </button>
              ) : null}
              {files.map((f) => (
                <button key={f.name} type="button" className="btn-secondary" onClick={() => save(f)}>
                  Download {f.name.endsWith(".pdf") ? "PDF" : "JPG"}
                </button>
              ))}
            </>
          ) : (
            <button type="button" className="btn-primary" disabled={making} onClick={make}>
              {making ? "Making the PDF…" : "Make PDF and JPG"}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onEdit}>
            Fix it in the editor
          </button>
          {signedIn ? (
            <button type="button" className="btn-secondary" onClick={onAddToClaim}>
              Add to a claim
            </button>
          ) : null}
        </div>
        <p className={styles.note}>The PDF is to scale (print at 100%), with every room&apos;s size; the JPG is to scale for a trace-over.</p>
      </div>
    </div>
  );
}

function Question({ q, read, builtLength, onAnswer, onSeePhoto }: { q: HandSketchQuestion; read: HandSketchRead; builtLength: (room: number, wall: number) => number; onAnswer: (a: HandSketchAnswer) => void; onSeePhoto: () => void }) {
  const [typed, setTyped] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const see = (
    <button type="button" className="link-button" onClick={onSeePhoto}>
      See it on the photo
    </button>
  );
  if (q.kind === "roomName") {
    return (
      <>
        <p className={styles.say}>
          <strong>What is this room?</strong> {q.guess ? `It looks like a ${q.guess}.` : ""}
        </p>
        <div className={styles.chips}>
          {ROOM_NAMES.map((name) => (
            <button key={name} type="button" className="option-btn" onClick={() => onAnswer({ kind: "roomName", name })}>
              {name}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <input type="text" aria-label="Another name" placeholder="Another name" value={other} onChange={(e) => setOther(e.target.value)} style={{ fontSize: 16, minHeight: 40, flex: "1 1 10rem" }} />
          <button type="button" className="btn-secondary" disabled={!other.trim()} onClick={() => onAnswer({ kind: "roomName", name: other })}>
            Use name
          </button>
        </div>
      </>
    );
  }
  if (q.kind === "doorWall") {
    return (
      <>
        <p className={styles.say}>
          <strong>Which wall is the door on?</strong> It is drawn at a corner, so it could be either. {see}
        </p>
        <div className={styles.row}>
          {q.walls.map((w, i) => (
            <button key={w} type="button" className="btn-secondary" onClick={() => onAnswer({ kind: "doorWall", wall: w })}>
              Wall {i + 1}, the {feetInches(builtLength(q.room, w))} one
            </button>
          ))}
        </div>
      </>
    );
  }
  if (q.kind === "isOpening") {
    return (
      <>
        <p className={styles.say}>
          <strong>Is there a door here?</strong> {q.note || "A wall drawn over heavily."} {see}
        </p>
        <div className={styles.row}>
          <button type="button" className="btn-secondary" onClick={() => onAnswer({ kind: "isOpening", yes: true })}>
            Yes, a door
          </button>
          <button type="button" className="btn-secondary" onClick={() => onAnswer({ kind: "isOpening", yes: false })}>
            No, just a wall
          </button>
        </div>
      </>
    );
  }
  const wallDiffers = q.kind === "wallDiffers";
  const kind = q.kind;
  return (
    <>
      <p className={styles.say}>
        {wallDiffers ? (
          <>
            <strong>
              You wrote {feetInches(q.written)}; the walls round it make it {feetInches(q.closes)}.
            </strong>{" "}
            The other walls are kept as written, so this one is set to close the room.
          </>
        ) : (
          <>
            <strong>No number on this wall.</strong> The drawing makes it about {feetInches(q.inches)}; a tape would settle it.
          </>
        )}{" "}
        {see}
      </p>
      <div className={styles.wallEntry}>
        <FeetInchesInput label="The wall's length" onChange={(feet) => setTyped(feet)} />
        <button type="button" className="btn-secondary" disabled={typed === null} onClick={() => typed !== null && onAnswer({ kind, length: lengthText(typed * 12) })}>
          Use it
        </button>
      </div>
      <div className={styles.row}>
        {wallDiffers ? (
          <button type="button" className="btn-primary" onClick={() => onAnswer({ kind, length: lengthText(q.closes) })}>
            Use {feetInches(q.closes)}
          </button>
        ) : null}
        <button type="button" className="btn-secondary" onClick={() => onAnswer({ kind, length: null })}>
          {wallDiffers ? "Leave it" : "Leave as drawn"}
        </button>
      </div>
    </>
  );
}
