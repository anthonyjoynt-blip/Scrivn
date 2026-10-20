"use client";

import { useMemo, useState } from "react";
import {
  type Deck,
  DECKING_KINDS,
  DECKING_LABEL,
  type DeckingKind,
  deckGeometry,
  type DeckQuantities,
  type DeckScreen,
  type DeckStair,
  decksOf,
  decksQuantities,
  DEFAULT_RAILING_FEET,
  deckPlanShapes,
  outlineToWalls,
  POST_MATERIAL_LABEL,
  type PostMaterial,
  quickDeck,
  type QuickDeck,
  quickDeckProblem,
  RAILING_KINDS,
  RAILING_SHORT,
  type RailingKind,
  railingsOnOpenEdges,
  ringInSideFrame,
  risersFor,
  SCREEN_LABEL,
  SCREEN_MATERIAL_LABEL,
  SCREEN_MATERIALS,
  type ScreenKind,
  type ScreenMaterial,
  stairWords,
  uniqueDeckName,
  withDeckAdded,
  withDeckChange,
} from "@/lib/decks";
import { type Exterior, exteriorFootprint, exteriorQuantities } from "@/lib/exterior";
import { formatFeetInches, newSketchId } from "@/lib/sketch";
import { DeckPlanDrawing } from "./deckDrawings";
import { Choice, CountInput, FeetField, FeetInput, lf, NumberField, sf } from "./exteriorFields";

/**
 * The decks tab (2026-10-20, lib/decks.ts): each deck or porch on its own plan, and everything it is in a few rows - the wall
 * it stands against and how far it comes out, its height, its decking, its railing, its stairs, its posts and screens - with
 * the quick-deck box to put one in with a tape, no photos, as the quick box puts in a shed. A deck off the photos is placed
 * on the Photos tab; it is changed here like any other.
 */

const NAMES = ["Deck", "Back deck", "Front porch"];
const RAIL_OPTIONS: [RailingKind | "none", string][] = [...RAILING_KINDS.map((k): [RailingKind, string] => [k, RAILING_SHORT[k]]), ["none", "None"]];
const DECKING_OPTIONS = DECKING_KINDS.map((k): [DeckingKind, string] => [k, DECKING_LABEL[k].replace(/ decking$/, "")]);

export function DecksPane({ exterior, readOnly, onChange }: { exterior: Exterior; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  const q = useMemo(() => exteriorQuantities(exterior), [exterior]);
  const decks = useMemo(() => decksQuantities(exterior, q.roof), [exterior, q.roof]);
  const [adding, setAdding] = useState(decks.length === 0);
  return (
    <div className="exterior-decks">
      <p className="field-note">
        Decks and porches: each against its wall, its ledger worked out from where it meets the house. What the house&rsquo;s roof covers is in the roof&rsquo;s squares already; its decking is never
        wall. Tick a deck under &ldquo;In the scope&rdquo; to put its lines on the scope.
      </p>
      {decks.map((dq) => (
        <DeckCard key={dq.deck.id} exterior={exterior} dq={dq} readOnly={readOnly} onChange={onChange} />
      ))}
      {!readOnly &&
        (adding ? (
          <QuickDeckBox exterior={exterior} onCancel={decks.length > 0 ? () => setAdding(false) : undefined} onAdd={(d) => (onChange((e) => withDeckAdded(e, d)), setAdding(false))} />
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
            + Deck
          </button>
        ))}
    </div>
  );
}

/** The quick-deck box: the wall, how wide and how far out, how high, the decking, the railing and a stair - a deck with a tape. */
function QuickDeckBox({ exterior, onAdd, onCancel }: { exterior: Exterior; onAdd: (d: Deck) => void; onCancel?: () => void }) {
  const fp = useMemo(() => exteriorFootprint(exterior), [exterior]);
  const taken = decksOf(exterior).map((d) => d.name);
  const [name, setName] = useState(uniqueDeckName("Deck", taken));
  const [sideId, setSideId] = useState<string>(exterior.sides[2]?.id ?? exterior.sides[0]?.id ?? "");
  const sideFeet = fp.closes ? (fp.lengthsFeet[fp.sideIds.indexOf(sideId)] ?? null) : null;
  const [width, setWidth] = useState<number | null>(null);
  const [fromLeft, setFromLeft] = useState<number | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [decking, setDecking] = useState<DeckingKind>("composite");
  const [railing, setRailing] = useState<RailingKind | "none">("aluminum");
  const [stairs, setStairs] = useState(true);
  const [stairWidth, setStairWidth] = useState<number | null>(4);
  const [problem, setProblem] = useState<string | null>(null);
  if (!fp.closes) return <p className="field-note">A deck stands against the house: close the outline first, on Plan &amp; roof.</p>;
  function make() {
    const box: QuickDeck = {
      name,
      sideId,
      fromLeftFeet: fromLeft,
      widthFeet: width ?? sideFeet ?? 0,
      depthFeet: depth ?? 0,
      heightFeet: height ?? -1,
      decking,
      railing,
      stairs: stairs ? { widthFeet: stairWidth ?? 0, where: "outer" } : null,
    };
    const why = quickDeckProblem(box);
    setProblem(why);
    if (!why) onAdd(quickDeck(exterior, box));
  }
  return (
    <div className="exterior-start-way exterior-quick">
      <h4 className="exterior-subhead">Quick deck</h4>
      <p className="field-note">Its wall, how far it comes out, how high it is, its railing and a stair. Everything can be changed after.</p>
      <div className="exterior-row">
        {NAMES.map((n) => (
          <button key={n} type="button" className={`option-btn${name === n ? " selected" : ""}`} aria-pressed={name === n} onClick={() => setName(uniqueDeckName(n, taken))}>
            {n}
          </button>
        ))}
      </div>
      <div className="exterior-row">
        <label className="exterior-row-label" htmlFor="qd-side">
          Against
        </label>
        <select id="qd-side" value={sideId} onChange={(e) => setSideId(e.target.value)}>
          {exterior.sides.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name.trim() || "Side"}
            </option>
          ))}
        </select>
      </div>
      <div className="exterior-grid">
        <FeetField id="qd-width" label="Along the wall" value={width} onCommit={setWidth} placeholder={sideFeet ? `${formatFeetInches(sideFeet)}, the wall` : "e.g. 16'"} />
        <FeetField id="qd-depth" label="Out from the wall" value={depth} onCommit={setDepth} placeholder="e.g. 12'" />
        <FeetField id="qd-height" label="Top off the ground" value={height} onCommit={setHeight} allowZero placeholder="e.g. 4'" />
        <FeetField id="qd-from" label="From the wall's left end" value={fromLeft} onCommit={setFromLeft} allowZero nullable placeholder="centred" note="As you face the wall from outside." />
      </div>
      <Choice label="Decking" value={decking} readOnly={false} options={DECKING_OPTIONS} onChange={setDecking} />
      <Choice label="Railing" value={railing} readOnly={false} options={RAIL_OPTIONS} onChange={setRailing} />
      <div className="exterior-row">
        <label className="exterior-tick">
          <input type="checkbox" checked={stairs} onChange={() => setStairs(!stairs)} />
          <span>Stairs off its outer edge</span>
        </label>
        {stairs && <FeetInput label="Stairs: width" value={stairWidth} onCommit={setStairWidth} />}
        {stairs && height !== null && height > 0 && <span className="field-note">{risersFor(height)} risers</span>}
      </div>
      {problem && <p className="sketch-length-error">{problem}</p>}
      <div className="exterior-row">
        <button type="button" className="btn-primary" onClick={make}>
          Add {name.toLowerCase()}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Its shape as the box has it: its ends along the wall and how far out, read off its outline. */
function boxOf(deck: Deck): { x0: number; x1: number; depth: number } {
  const xs = deck.outline.map((p) => p.x);
  return { x0: Math.min(...xs), x1: Math.max(...xs), depth: Math.max(...deck.outline.map((p) => p.y)) };
}

/** The deck with a new outline: its railings on its new open edges in its main kind, its stairs kept on its outer edge. */
function reshaped(exterior: Exterior, deck: Deck, sideId: string, x0: number, x1: number, depth: number): Deck {
  const ring = ringInSideFrame(exterior, sideId);
  if (!ring || !(x1 - x0 > 0.5) || !(depth > 0.5)) return deck;
  const outline = outlineToWalls(ring, x0, x1, depth);
  if (outline.length < 3) return deck;
  const main = deck.railings[0];
  const outerLen = Math.abs((outline[1]?.x ?? 0) - (outline[0]?.x ?? 0));
  const next: Deck = {
    ...deck,
    sideId,
    outline,
    stairs: deck.stairs.map((s) => ({ ...s, edge: 0, atFeet: Math.max(s.widthFeet / 2, Math.min(outerLen - s.widthFeet / 2, s.atFeet)) })),
    screens: deck.screens.filter((s) => s.edge < outline.length),
    posts: deck.posts ? { ...deck.posts, at: undefined } : null,
  };
  const fp = exteriorFootprint(exterior);
  const geom = deckGeometry(exterior, next, fp);
  if (geom && main) next.railings = railingsOnOpenEdges(next, geom, main.kind, main.heightFeet);
  return next;
}

function DeckCard({ exterior, dq, readOnly, onChange }: { exterior: Exterior; dq: DeckQuantities; readOnly: boolean; onChange: (f: (e: Exterior) => Exterior) => void }) {
  const deck = dq.deck;
  const set = (f: (d: Deck) => Deck | undefined) => onChange((e) => withDeckChange(e, deck.id, f));
  const fp = exteriorFootprint(exterior);
  const shape = deckPlanShapes({ ...exterior, decks: [deck] })[0];
  const box = boxOf(deck);
  const edges = dq.geometry?.edges ?? [];
  const open = edges.filter((e) => e.ledgerFeet < 0.5 * e.lengthFeet);
  const kinds = [...new Set(deck.railings.map((r) => r.kind))];
  const railKind: RailingKind | "none" = deck.railings.length === 0 ? "none" : (kinds[0] ?? "none");
  const railHeight = deck.railings[0]?.heightFeet ?? DEFAULT_RAILING_FEET;
  const setRailing = (kind: RailingKind | "none", height = railHeight) =>
    set((d) => {
      if (kind === "none") return { ...d, railings: [] };
      const geom = deckGeometry(exterior, d, fp);
      return geom ? { ...d, railings: railingsOnOpenEdges(d, geom, kind, height) } : d;
    });
  const setStair = (id: string, f: (s: DeckStair) => DeckStair | null) => set((d) => ({ ...d, stairs: d.stairs.flatMap((s) => (s.id !== id ? [s] : f(s) ? [f(s) as DeckStair] : [])) }));
  const setScreen = (id: string, f: (s: DeckScreen) => DeckScreen | null) => set((d) => ({ ...d, screens: d.screens.flatMap((s) => (s.id !== id ? [s] : f(s) ? [f(s) as DeckScreen] : [])) }));
  const edgeName = (i: number) => edges[i]?.name ?? `edge ${i + 1}`;
  return (
    <div className="exterior-start-way exterior-deck">
      <div className="exterior-row">
        <input
          type="text"
          aria-label="The deck's name"
          key={deck.name}
          defaultValue={deck.name}
          maxLength={40}
          disabled={readOnly}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== deck.name) set((d) => ({ ...d, name: uniqueDeckName(v, decksOf(exterior).filter((x) => x.id !== d.id).map((x) => x.name)) }));
            else e.target.value = deck.name;
          }}
        />
        <span className="field-note">
          {sf(dq.areaSquareFeet)} · {formatFeetInches(dq.heightFeet)} up · ledger {lf(dq.ledgerFeet)}
          {dq.coveredSquareFeet > 0.5 ? ` · ${sf(dq.coveredSquareFeet)} under the roof` : ""}
          {deck.from === "photos" ? " · off the photos" : ""}
        </span>
      </div>
      {shape && fp.closes && (
        <div className="exterior-deck-plan">
          <DeckPlanDrawing footprint={fp} shape={shape} />
        </div>
      )}
      <div className="exterior-row">
        <label className="exterior-row-label" htmlFor={`deck-side-${deck.id}`}>
          Against
        </label>
        <select id={`deck-side-${deck.id}`} value={deck.sideId ?? ""} disabled={readOnly || deck.sideId === null} onChange={(e) => set((d) => reshaped(exterior, d, e.target.value, box.x0, box.x1, box.depth))}>
          {deck.sideId === null && <option value="">Free-standing</option>}
          {exterior.sides.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name.trim() || "Side"}
            </option>
          ))}
        </select>
      </div>
      {deck.sideId && (
        <div className="exterior-grid">
          <FeetField id={`deck-from-${deck.id}`} label="From the wall's left end" value={box.x0} allowZero readOnly={readOnly} onCommit={(v) => v !== null && set((d) => reshaped(exterior, d, d.sideId as string, v, v + (box.x1 - box.x0), box.depth))} />
          <FeetField id={`deck-width-${deck.id}`} label="Along the wall" value={box.x1 - box.x0} readOnly={readOnly} onCommit={(v) => v !== null && set((d) => reshaped(exterior, d, d.sideId as string, box.x0, box.x0 + v, box.depth))} />
          <FeetField id={`deck-depth-${deck.id}`} label="Out from the wall" value={box.depth} readOnly={readOnly} onCommit={(v) => v !== null && set((d) => reshaped(exterior, d, d.sideId as string, box.x0, box.x1, v))} />
        </div>
      )}
      <div className="exterior-grid">
        <FeetField id={`deck-h-${deck.id}`} label="Top off the ground at the wall" value={deck.heightFeet} allowZero readOnly={readOnly} onCommit={(v) => v !== null && set((d) => ({ ...d, heightFeet: v }))} />
        <FeetField
          id={`deck-ho-${deck.id}`}
          label="At its outer edge"
          value={deck.heightOutFeet ?? null}
          allowZero
          nullable
          readOnly={readOnly}
          placeholder="the same"
          note="Where the ground steps down or up under it."
          onCommit={(v) =>
            set((d) => {
              const { heightOutFeet: _was, ...rest } = d;
              return v === null ? rest : { ...rest, heightOutFeet: v };
            })
          }
        />
      </div>
      <Choice label="Decking" value={deck.decking} readOnly={readOnly} options={DECKING_OPTIONS} onChange={(k) => set((d) => ({ ...d, decking: k, deckingRead: d.deckingRead ? { ...d.deckingRead, confirmed: true as const } : undefined }))} />
      <Choice label="Railing round its open edges" value={kinds.length > 1 ? null : railKind} readOnly={readOnly} options={RAIL_OPTIONS} onChange={(k) => setRailing(k)} hint={kinds.length > 1 ? `Railings of ${kinds.length} kinds: a tap puts one kind all round.` : undefined} />
      {deck.railings.length > 0 && (
        <div className="exterior-row">
          <FeetField id={`deck-rh-${deck.id}`} label="Railing height" value={railHeight} readOnly={readOnly} onCommit={(v) => v !== null && set((d) => ({ ...d, railings: d.railings.map((r) => ({ ...r, heightFeet: v })) }))} />
          <span className="field-note">{dq.railingByKind.map((r) => `${r.label} ${lf(r.feet)}`).join(" · ")}</span>
        </div>
      )}
      <h4 className="exterior-subhead">Stairs</h4>
      {deck.stairs.map((s) => {
        const g = dq.stairs.find((x) => x.stair.id === s.id);
        return (
          <div key={s.id} className="exterior-row exterior-deck-stair">
            <select aria-label="Off which edge" value={s.edge} disabled={readOnly} onChange={(e) => setStair(s.id, (x) => ({ ...x, edge: Number(e.target.value), atFeet: (edges[Number(e.target.value)]?.lengthFeet ?? 0) / 2 }))}>
              {open.map((e) => (
                <option key={e.index} value={e.index}>
                  Off {edgeName(e.index)}
                </option>
              ))}
            </select>
            <FeetInput label="Stairs: width" value={s.widthFeet} readOnly={readOnly} onCommit={(v) => v !== null && setStair(s.id, (x) => ({ ...x, widthFeet: v }))} />
            <CountInput label="Stairs: risers" value={s.risers} readOnly={readOnly} onCommit={(v) => v > 0 && setStair(s.id, (x) => ({ ...x, risers: v, confirmed: true as const }))} />
            <span className="field-note">risers{g ? ` · ${stairWords(g)}` : ""}</span>
            {!readOnly && (
              <button type="button" className="btn-secondary exterior-row-x" aria-label="Take the stairs off" onClick={() => setStair(s.id, () => null)}>
                ×
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && open.length > 0 && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            set((d) => ({
              ...d,
              stairs: [...d.stairs, { id: newSketchId("stair"), edge: open[0]?.index ?? 0, atFeet: (open[0]?.lengthFeet ?? 8) / 2, widthFeet: 4, risers: risersFor(d.heightOutFeet ?? d.heightFeet), railing: d.railings[0] ? { kind: d.railings[0].kind, sides: 2 } : null }],
            }))
          }
        >
          + Stairs
        </button>
      )}
      <h4 className="exterior-subhead">Underneath</h4>
      <div className="exterior-row">
        <span className="exterior-row-label">Posts</span>
        <CountInput label="Posts: how many" value={deck.posts?.count ?? 0} readOnly={readOnly} onCommit={(v) => set((d) => ({ ...d, posts: { ...(d.posts ?? {}), count: v, confirmed: true as const, at: undefined } }))} />
        <NumberField id={`deck-ps-${deck.id}`} label="Size, inches" value={deck.posts?.sizeInches ?? 6} integer max={24} readOnly={readOnly} onCommit={(v) => v !== null && set((d) => ({ ...d, posts: { ...(d.posts ?? { count: 0 }), sizeInches: v } }))} />
        <select aria-label="Posts: what they are" value={deck.posts?.material ?? ""} disabled={readOnly} onChange={(e) => set((d) => ({ ...d, posts: { ...(d.posts ?? { count: 0 }), material: (e.target.value || undefined) as PostMaterial | undefined } }))}>
          <option value="">Material</option>
          {(Object.keys(POST_MATERIAL_LABEL) as PostMaterial[]).map((m) => (
            <option key={m} value={m}>
              {POST_MATERIAL_LABEL[m]}
            </option>
          ))}
        </select>
      </div>
      {deck.screens.map((s) => (
        <div key={s.id} className="exterior-row">
          <span className="exterior-row-label">{SCREEN_LABEL[s.kind]}</span>
          <select aria-label="Along which edge" value={s.edge} disabled={readOnly} onChange={(e) => setScreen(s.id, (x) => ({ ...x, edge: Number(e.target.value), fromFeet: undefined, toFeet: undefined }))}>
            {edges.map((e) => (
              <option key={e.index} value={e.index}>
                {edgeName(e.index)}
              </option>
            ))}
          </select>
          <FeetInput label={`${SCREEN_LABEL[s.kind]}: height`} value={s.heightFeet} readOnly={readOnly} onCommit={(v) => v !== null && setScreen(s.id, (x) => ({ ...x, heightFeet: v }))} />
          <select aria-label={`${SCREEN_LABEL[s.kind]}: material`} value={s.material} disabled={readOnly} onChange={(e) => setScreen(s.id, (x) => ({ ...x, material: e.target.value as ScreenMaterial }))}>
            {SCREEN_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {SCREEN_MATERIAL_LABEL[m]}
              </option>
            ))}
          </select>
          {!readOnly && (
            <button type="button" className="btn-secondary exterior-row-x" aria-label={`Take the ${SCREEN_LABEL[s.kind].toLowerCase()} off`} onClick={() => setScreen(s.id, () => null)}>
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="exterior-row">
          {(["privacy", "skirting"] as ScreenKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="btn-secondary"
              onClick={() =>
                set((d) => ({ ...d, screens: [...d.screens, { id: newSketchId("screen"), kind, edge: open[0]?.index ?? 0, heightFeet: kind === "privacy" ? 6 : Math.max(1, d.heightFeet - 0.75), material: kind === "privacy" ? "wood" : "lattice" }] }))
              }
            >
              + {SCREEN_LABEL[kind]}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (window.confirm(`Take ${deck.name} away?`)) set(() => undefined);
            }}
          >
            Remove {deck.name.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}
