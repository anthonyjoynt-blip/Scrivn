"use client";

/**
 * The tidied scope on the Drop a sketch or scope page (2026-11-12), as a document to check and change: room by room,
 * each line in plain trade words with its quantity, what was written beside it, and a flag on any line that may be
 * misread. Lines are under Emergency or Repair only where the page put them there (lib/tidyScope.ts). Downloads as a
 * PDF, with the plan at the back when there is one.
 */
import { useState } from "react";
import { DEFAULT_LETTERHEAD } from "@/lib/letterhead";
import type { Sketch } from "@/lib/sketch";
import {
  GENERAL,
  PHASE_HEADINGS,
  addLine,
  addRoom,
  lineRight,
  linesByPhase,
  planRoomFor,
  removeLine,
  removeNote,
  removeRoom,
  setLine,
  setRoom,
  sizeWords,
  tidyFlaggedCount,
  tidyLineCount,
  tidyPdfTables,
  type PlanRoomSize,
  type TidyLine,
  type TidyScope,
} from "@/lib/tidyScope";
import { planPage, saveFile } from "./planFiles";
import styles from "./handSketch.module.css";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function Line({ line, onChange }: { line: TidyLine; onChange: (fn: (doc: TidyScope) => TidyScope) => void }) {
  const written = line.written.trim();
  return (
    <div className={`${styles.docLine} ${line.unsure ? styles.docLineFlag : ""}`}>
      <div className={styles.docLineTop}>
        <input
          type="text"
          className={styles.docWork}
          aria-label="Work"
          placeholder="The work"
          value={line.plain}
          onChange={(e) => {
            const plain = e.target.value;
            onChange((d) => setLine(d, line.id, { plain }));
          }}
        />
        <button type="button" className={styles.docRemove} aria-label="Remove this line" onClick={() => onChange((d) => removeLine(d, line.id))}>
          ×
        </button>
      </div>
      <div className={styles.docLineMeta}>
        <input
          type="text"
          className={styles.docQty}
          aria-label="Quantity"
          placeholder="Quantity"
          value={line.quantity}
          onChange={(e) => {
            const quantity = e.target.value;
            onChange((d) => setLine(d, line.id, { quantity }));
          }}
        />
        {written && squash(written) !== squash(line.plain) ? (
          <span className={styles.docWritten}>
            Written: <q>{written}</q>
          </span>
        ) : null}
      </div>
      {line.unsure ? (
        <p className={styles.docFlagNote}>
          <span>May be misread: check it against the page.</span>
          <button type="button" className="btn-secondary" onClick={() => onChange((d) => lineRight(d, line.id))}>
            Looks right
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Lines({ lines, to, onChange }: { lines: TidyLine[]; to: string; onChange: (fn: (doc: TidyScope) => TidyScope) => void }) {
  const groups = linesByPhase(lines);
  return (
    <>
      {groups.map((g) => (
        <div key={g.phase ?? "none"} className={styles.docGroup}>
          {g.phase ? <p className={styles.docPhase}>{PHASE_HEADINGS[g.phase]}</p> : null}
          {g.lines.map((l) => (
            <Line key={l.id} line={l} onChange={onChange} />
          ))}
        </div>
      ))}
      <button type="button" className="link-button" onClick={() => onChange((d) => addLine(d, to).doc)}>
        Add a line
      </button>
    </>
  );
}

export function ScopeDoc({
  doc,
  plan,
  planSketch,
  edited,
  stale,
  onChange,
  onRebuild,
}: {
  doc: TidyScope;
  /** The plan's rooms and sizes, to head each room with; empty with no sketch. */
  plan: PlanRoomSize[];
  /** The plan itself, drawn at the back of the PDF. */
  planSketch: Sketch | null;
  /** The person has changed it. */
  edited: boolean;
  /** Pages were read or checked since it was changed, and are not in it. */
  stale: boolean;
  onChange: (doc: TidyScope) => void;
  /** Back to Scrivn's tidying of the pages as they stand, the person's changes gone. */
  onRebuild: () => void;
}) {
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (fn: (d: TidyScope) => TidyScope) => onChange(fn(doc));
  const lines = tidyLineCount(doc);
  const flagged = tidyFlaggedCount(doc);

  const download = async () => {
    setMaking(true);
    setError(null);
    try {
      const { documentPdfBlob } = await import("@/lib/pdf");
      const picture = planSketch && planSketch.rooms.length ? await planPage(planSketch) : null;
      const columns = [
        { title: "Work", weight: 5 },
        { title: "Quantity", weight: 2 },
        { title: "As written", weight: 4 },
      ];
      const tables = tidyPdfTables(doc, plan).map((t) => ({ caption: t.caption, columns, rows: t.rows }));
      const notes = doc.notes.map((n) => n.trim()).filter(Boolean);
      if (notes.length) tables.push({ caption: "Notes on the scope", columns: [{ title: "Note", weight: 1 }], rows: notes.map((n) => [n]) });
      if (doc.unreadable.length) tables.push({ caption: "Could not be read", columns: [{ title: "Where", weight: 1 }], rows: doc.unreadable.map((u) => [`Page ${u.page}: ${u.what}`]) });
      const from = doc.files.length ? ` (${doc.files.join(", ")})` : "";
      const body = [
        `Tidied by Scrivn from ${doc.pages} page${doc.pages === 1 ? "" : "s"}${from} on ${new Date().toLocaleDateString()}.`,
        flagged ? `${flagged} line${flagged === 1 ? " is" : "s are"} marked "check: may be misread".` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const blob = documentPdfBlob({
        docLabel: "Scope",
        bodyText: body,
        jobNumber: "",
        customerName: "",
        letterhead: DEFAULT_LETTERHEAD,
        tables,
        sketchImages: picture ? [{ ...picture, caption: "Floor plan" }] : undefined,
      });
      saveFile({ name: "Scope.pdf", mime: "application/pdf", blob });
    } catch (err) {
      setError(`The PDF could not be made: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className={styles.doc}>
      <p className={styles.note}>
        {lines} line{lines === 1 ? "" : "s"} of work in {doc.rooms.length} room{doc.rooms.length === 1 ? "" : "s"}, from {doc.pages} page{doc.pages === 1 ? "" : "s"}.{" "}
        {flagged ? (
          <strong>
            {flagged} may be misread: check {flagged === 1 ? "it" : "them"} against the page.
          </strong>
        ) : (
          "Check each line against the page."
        )}
      </p>
      {stale || edited ? (
        <p className={stale ? styles.error : styles.note}>
          {stale ? "A page read or checked since you changed the scope is not in it. " : "Changed by you. "}
          <button type="button" className="link-button" onClick={onRebuild}>
            {stale ? "Tidy it again from the pages" : "Start again from the pages"}
          </button>
          {stale ? " (your changes go)." : null}
        </p>
      ) : null}

      {doc.rooms.map((room) => {
        const size = planRoomFor(plan, room.name);
        return (
          <section key={room.id} className={styles.docRoom} aria-label={room.name || "Room"}>
            <div className={styles.docLineTop}>
              <input
                type="text"
                className={styles.docRoomName}
                aria-label="Room name"
                placeholder="Room name"
                value={room.name}
                onChange={(e) => {
                  const name = e.target.value;
                  change((d) => setRoom(d, room.id, { name }));
                }}
              />
              <button
                type="button"
                className={styles.docRemove}
                aria-label={`Remove ${room.name || "this room"}`}
                onClick={() => {
                  if (room.lines.some((l) => l.plain.trim()) && !window.confirm(`Take ${room.name || "this room"} and its lines out of the scope?`)) return;
                  change((d) => removeRoom(d, room.id));
                }}
              >
                ×
              </button>
            </div>
            {size || room.scopeName || room.level ? (
              <p className={styles.docRoomNote}>{[room.level ? room.level : "", size ? `On the plan: ${sizeWords(size)}` : "", room.scopeName ? `On the scope: ${room.scopeName}` : ""].filter(Boolean).join(" · ")}</p>
            ) : null}
            <Lines lines={room.lines} to={room.id} onChange={change} />
          </section>
        );
      })}

      {doc.general.length ? (
        <section className={styles.docRoom} aria-label="Whole job">
          <p className={styles.docRoomTitle}>Whole job</p>
          <Lines lines={doc.general} to={GENERAL} onChange={change} />
        </section>
      ) : null}

      <div className={styles.row}>
        <button type="button" className="btn-secondary" onClick={() => change((d) => addRoom(d).doc)}>
          Add a room
        </button>
        {doc.general.length === 0 ? (
          <button type="button" className="btn-secondary" onClick={() => change((d) => addLine(d, GENERAL).doc)}>
            Add whole-job work
          </button>
        ) : null}
      </div>

      {doc.notes.length ? (
        <section className={styles.docRoom} aria-label="Notes on the scope">
          <p className={styles.docRoomTitle}>Notes on the scope</p>
          <ul className={styles.docNotes}>
            {doc.notes.map((n, i) => (
              <li key={`${i}-${n}`}>
                <span>{n}</span>
                <button type="button" className={styles.docRemove} aria-label="Remove this note" onClick={() => change((d) => removeNote(d, i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {doc.unreadable.length ? (
        <section className={styles.docRoom} aria-label="Could not be read">
          <p className={styles.docRoomTitle}>Could not be read</p>
          <ul className={styles.docNotes}>
            {doc.unreadable.map((u, i) => (
              <li key={i}>
                <span>
                  Page {u.page}: {u.what}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" className="btn-primary" disabled={making || lines === 0} onClick={() => void download()}>
          {making ? "Making the PDF…" : "Download the scope as a PDF"}
        </button>
      </div>
    </div>
  );
}
