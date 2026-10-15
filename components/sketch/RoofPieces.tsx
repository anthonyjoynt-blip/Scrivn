"use client";

import type { ReactNode } from "react";
import { type ExteriorRoof, formatPitch, pieceWords } from "@/lib/exterior";
import { newRoofPiece } from "@/lib/exteriorPlan";
import { editedPiece, pieceCounts, type PieceFigures, pieceFigures, pieceFromPhotos, type PieceLengthKey, ROOF_PIECE_KINDS, ROOF_PIECE_LABEL, type RoofPiece, type RoofPieceKind } from "@/lib/roofPieces";
import { formatQuantity } from "@/lib/sketchQuantities";
import { Choice, FeetField, NumberField } from "./exteriorFields";

/**
 * "Add a roof piece" (2026-10-15): what the drawing can't make - a dormer, a turret, a curved or flat
 * roof - put on top of it, so one dormer no longer means typing the whole roof. Each piece's
 * quantities ADD to the drawing's; a total typed in the roof totals still stands for the drawing and
 * the pieces alike, as a roof report already counts its dormers. A piece put on with nothing typed
 * counts nothing and is asked for. One proposed off the photos counts once ticked, and a number of
 * it changed makes it the estimator's. The maths is lib/roofPieces.ts.
 */

type Update = (f: (roof: ExteriorRoof) => ExteriorRoof) => void;

const LENGTH_WORDS: Record<PieceLengthKey, string> = { ridge: "Ridge", hip: "Hips", valley: "Valleys", eave: "Eaves", rake: "Rakes", step: "Step flashing", headwall: "Headwall flashing" };

/** What a piece adds, in a line: its area at its pitches, then each length it gives. */
function figuresWords(piece: RoofPiece, f: PieceFigures): string {
  const ft = (v: number) => `${formatQuantity(v)}'`;
  const own = f.areas.filter((a) => a.squareFeet > 0);
  const covers = f.areas.filter((a) => a.squareFeet < 0);
  const at = (p: number | null) => (p === null ? "curved" : `at ${formatPitch(p)}`);
  const area =
    covers.length > 0
      ? `${f.squareFeet < 0 ? "-" : "+"}${formatQuantity(Math.abs(f.squareFeet))} SF net: ${own.map((a) => `${formatQuantity(a.squareFeet)} SF ${at(a.pitch)}`).join(", ")}, less ${covers.map((a) => `${formatQuantity(-a.squareFeet)} SF of the ${formatPitch(a.pitch ?? 0)} slope it covers`).join(", ")}`
      : own.length > 0
        ? `+${own.map((a) => `${formatQuantity(a.squareFeet)} SF ${at(a.pitch)}`).join(", ")}`
        : "";
  // A dormer's apron is counted with the headwall flashing: said apart here.
  const named: [string, number][] = (Object.keys(LENGTH_WORDS) as PieceLengthKey[]).map((k) => [LENGTH_WORDS[k], k === "headwall" ? f.lengths.headwall - f.apronFeet : f.lengths[k]]);
  named.push(["Apron flashing", f.apronFeet], ["Drip edge", f.dripEdgeFeet]);
  const lengths = named.filter(([, v]) => v > 0.005).map(([w, v]) => `${w.toLowerCase()} ${ft(v)}`);
  const siding = f.sidingSquareFeet > 0 ? [`cheeks & face ${formatQuantity(f.sidingSquareFeet)} SF of siding`] : [];
  return [area, ...lengths, ...siding].filter(Boolean).join(" · ");
}

function PieceCard({ piece, index, roofPitch, readOnly, onSet, onRemove }: { piece: RoofPiece; index: number; roofPitch: number; readOnly: boolean; onSet: (f: (p: RoofPiece) => RoofPiece) => void; onRemove: () => void }) {
  const id = (what: string) => `roof-piece-${piece.id}-${what}`;
  const edit = (change: Partial<RoofPiece>) => onSet((p) => editedPiece(p, change));
  const name = `${pieceWords(piece)} ${index + 1}`;
  const feet = (what: string, label: string, key: keyof RoofPiece, note?: string) => (
    <FeetField id={id(what)} label={label} value={(piece[key] as number | null | undefined) ?? null} readOnly={readOnly} nullable note={note} onCommit={(v) => edit({ [key]: v })} />
  );
  const number = (what: string, label: string, key: keyof RoofPiece, opts: { integer?: boolean; max?: number; placeholder?: string; note?: string } = {}) => (
    <NumberField id={id(what)} label={label} value={(piece[key] as number | null | undefined) ?? null} readOnly={readOnly} {...opts} onCommit={(v) => edit({ [key]: v })} />
  );
  const pitch = (label = "Its pitch (rise in 12)") => number("pitch", label, "pitch", { max: 48 });
  const f = pieceFigures(piece, roofPitch);
  let fields: ReactNode;
  switch (piece.kind) {
    case "gableDormer":
    case "shedDormer":
      fields = (
        <>
          {feet("width", "Width, across its face", "widthFeet")}
          {feet("projection", "Projection", "projectionFeet", "Its face back to where it meets the roof, in plan.")}
          {pitch()}
          {number("on", "On a slope of (rise in 12)", "onPitch", { max: 48, placeholder: `${Math.round(roofPitch * 100) / 100} as the roof` })}
        </>
      );
      break;
    case "roundTurret":
      fields = (
        <>
          {feet("diameter", "Diameter", "diameterFeet")}
          {pitch()}
        </>
      );
      break;
    case "polygonTurret":
      fields = (
        <>
          {number("sides", "Sides", "sideCount", { integer: true, max: 24 })}
          {feet("side", "Each side", "sideFeet")}
          {pitch()}
        </>
      );
      break;
    case "barrel":
      fields = (
        <>
          {feet("span", "Span", "spanFeet")}
          {feet("length", "Length", "lengthFeet")}
          {feet("rise", "Rise of the arc", "riseFeet")}
        </>
      );
      break;
    case "flat":
      fields = (
        <>
          {number("sf", "Area (SF)", "squareFeet", { max: 100000 })}
          {feet("perimeter", "Perimeter", "perimeterFeet")}
          <Choice
            label="Its edge"
            value={piece.perimeterAs ?? "eave"}
            readOnly={readOnly}
            options={[
              ["eave", "Eave"],
              ["dripEdge", "Drip edge only"],
            ]}
            onChange={(v) => edit({ perimeterAs: v })}
          />
        </>
      );
      break;
    case "other":
      fields = (
        <>
          <div className="exterior-field">
            <label className="exterior-field-label" htmlFor={id("label")}>
              What it is
            </label>
            <input
              id={id("label")}
              className="exterior-feet"
              type="text"
              autoComplete="off"
              key={`${id("label")}-${piece.label ?? ""}`}
              defaultValue={piece.label ?? ""}
              placeholder="e.g. bay roof"
              disabled={readOnly}
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label !== (piece.label ?? "")) edit({ label: label || undefined });
              }}
            />
          </div>
          {number("sf", "Area (SF)", "squareFeet", { max: 100000 })}
          {number("pitch", "Pitch (rise in 12)", "pitch", { max: 48, placeholder: `${Math.round(roofPitch * 100) / 100} as the roof` })}
          {(Object.keys(LENGTH_WORDS) as PieceLengthKey[]).map((k) => (
            <FeetField
              key={k}
              id={id(k)}
              label={LENGTH_WORDS[k]}
              value={piece.lengths?.[k] ?? null}
              readOnly={readOnly}
              nullable
              onCommit={(v) => edit({ lengths: { ...(piece.lengths ?? {}), [k]: v } })}
            />
          ))}
        </>
      );
      break;
  }
  return (
    <div className="roof-piece">
      <div className="exterior-row">
        <span className="exterior-row-label">
          <strong>{name}</strong>
        </span>
        <span className="exterior-row-note">How many alike</span>
        <input
          className="exterior-feet exterior-count"
          type="text"
          inputMode="numeric"
          aria-label={`${name}: how many alike`}
          key={`${id("count")}-${piece.count ?? 1}`}
          defaultValue={String(piece.count ?? 1)}
          disabled={readOnly}
          onBlur={(e) => {
            const n = Math.round(Number(e.target.value.trim()));
            if (!Number.isFinite(n) || n < 1 || n > 20) {
              e.target.value = String(piece.count ?? 1);
              return;
            }
            if (n !== (piece.count ?? 1)) edit({ count: n });
          }}
        />
        {pieceFromPhotos(piece) && (
          <label className="exterior-row-note">
            <input type="checkbox" checked={piece.taken === true} disabled={readOnly} onChange={(e) => onSet((p) => ({ ...p, taken: e.target.checked }))} /> From photos: count it
          </label>
        )}
        {!readOnly && (
          <button type="button" className="btn-secondary exterior-row-x" aria-label={`Remove ${name}`} onClick={onRemove}>
            ×
          </button>
        )}
      </div>
      <div className="exterior-grid">{fields}</div>
      <p className={f.missing.length > 0 || !pieceCounts(piece) ? "exterior-assumed" : "field-note"}>
        {f.missing.length > 0
          ? `Counts nothing until it has ${f.missing.length === 1 ? f.missing[0] : `${f.missing.slice(0, -1).join(", ")} and ${f.missing[f.missing.length - 1]}`}.`
          : pieceCounts(piece)
            ? `Adds ${figuresWords(piece, f)}${pieceFromPhotos(piece) ? ", from photos" : ""}.`
            : `Read off the photos: it would add ${figuresWords(piece, f)}. It counts once ticked; change a number and it is yours.`}
      </p>
    </div>
  );
}

export function RoofPiecesPanel({ roof, roofPitch, readOnly, onUpdate }: { roof: ExteriorRoof; roofPitch: number; readOnly: boolean; onUpdate: Update }) {
  const pieces = roof.pieces ?? [];
  const set = (id: string, f: (p: RoofPiece) => RoofPiece) => onUpdate((x) => ({ ...x, pieces: (x.pieces ?? []).map((p) => (p.id === id ? f(p) : p)) }));
  return (
    <div className="exterior-rows roof-pieces">
      <h4 className="exterior-subhead">Roof pieces</h4>
      <p className="field-note">
        What the drawing can&rsquo;t make &ndash; a dormer, a turret, a curved or flat roof &ndash; put on top of it: each piece&rsquo;s quantities are added to the drawing&rsquo;s. A roof total typed by you
        stands for the drawing and the pieces alike, as a roof report already counts its dormers. Sizes are to the walls: add an overhang if it is wanted.
      </p>
      {pieces.map((p, i) => (
        <PieceCard key={p.id} piece={p} index={i} roofPitch={roofPitch} readOnly={readOnly} onSet={(f) => set(p.id, f)} onRemove={() => onUpdate((x) => ({ ...x, pieces: (x.pieces ?? []).filter((y) => y.id !== p.id) }))} />
      ))}
      {!readOnly && (
        <select
          className="roof-piece-add"
          aria-label="Add a roof piece"
          value=""
          onChange={(e) => {
            const kind = e.target.value as RoofPieceKind;
            if (ROOF_PIECE_KINDS.includes(kind)) onUpdate((x) => ({ ...x, pieces: [...(x.pieces ?? []), newRoofPiece(kind)] }));
          }}
        >
          <option value="">+ Add a roof piece…</option>
          {ROOF_PIECE_KINDS.map((k) => (
            <option key={k} value={k}>
              {ROOF_PIECE_LABEL[k]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
