"use client";

import { useState } from "react";
import { CLADDING_LABEL, type CladdingKind, type Exterior, type ExteriorOpeningKind, OPENING_LABEL } from "@/lib/exterior";
import { QUICK_WALLS, type QuickOpening, type QuickRoof, quickBoxExterior, quickBoxProblem, quickOpening } from "@/lib/buildings";
import { Choice, FeetField, FeetInput, NumberField } from "./exteriorFields";
import { useExteriorSubject } from "./exteriorSubject";

/** The sidings an outbuilding is usually in, vinyl first: the owner's shed. Anything else is changed on a side after. */
const SIDINGS: CladdingKind[] = ["vinyl", "wood", "metal", "fibre_cement", "stucco"];

/**
 * The quick box (2026-10-16, lib/buildings.ts): a simple building with a tape, in one card - its two lengths, the
 * wall height, the roof (gable, one slope or hip) and its pitch, the siding, and a door or window with a tap. A shed
 * in under a minute. What it makes is an ordinary exterior: the plan, the sides face-on and the roof are all there
 * after, to move a window or turn the ridge, as on the house.
 */
export function QuickBoxStart({ readOnly, onStart }: { readOnly: boolean; onStart: (exterior: Exterior) => void }) {
  const { the } = useExteriorSubject();
  const [width, setWidth] = useState<number | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [wall, setWall] = useState<number | null>(8);
  const [roof, setRoof] = useState<QuickRoof>("gable");
  const [pitch, setPitch] = useState<number | null>(null);
  const [cladding, setCladding] = useState<CladdingKind>("vinyl");
  const [openings, setOpenings] = useState<QuickOpening[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  if (readOnly) return null;

  const add = (kind: ExteriorOpeningKind) => setOpenings((list) => [...list, quickOpening(kind, 0)]);
  const set = (id: string, f: (o: QuickOpening) => QuickOpening) => setOpenings((list) => list.map((o) => (o.id === id ? f(o) : o)));
  function make() {
    const box = { widthFeet: width ?? 0, depthFeet: depth ?? 0, wallFeet: wall ?? 0, roof, pitch, cladding, openings };
    const why = quickBoxProblem(box);
    setProblem(why);
    if (!why) onStart(quickBoxExterior(box));
  }

  return (
    <div className="exterior-start-way exterior-quick">
      <h4 className="exterior-subhead">Quick box</h4>
      <p className="field-note">For a simple building: its two lengths, the wall height, the roof, and its doors and windows. Everything can be changed after, on the plan and each side.</p>
      <div className="exterior-grid">
        <FeetField id="qb-width" label="Width (the front)" value={width} onCommit={setWidth} placeholder="e.g. 12'" />
        <FeetField id="qb-depth" label="Depth (the sides)" value={depth} onCommit={setDepth} placeholder="e.g. 16'" />
        <FeetField id="qb-wall" label="Wall height" value={wall} onCommit={setWall} note="Ground to the top of the wall." />
        <NumberField id="qb-pitch" label="Pitch (rise in 12)" value={pitch} onCommit={setPitch} max={24} placeholder="4 assumed" />
      </div>
      <Choice
        label="Roof"
        hint={roof === "gable" ? "The ridge runs along the longer walls: turn it on the plan." : roof === "one" ? "Low at the rear, high at the front: change it on the plan." : "Sloping up from every wall."}
        value={roof}
        readOnly={false}
        options={[
          ["gable", "Gable"],
          ["one", "One slope"],
          ["hip", "Hip"],
        ]}
        onChange={setRoof}
      />
      <Choice label="Siding" value={cladding} readOnly={false} options={SIDINGS.map((k) => [k, CLADDING_LABEL[k]] as [CladdingKind, string])} onChange={setCladding} />
      {openings.map((o) => (
        <div key={o.id} className="exterior-row exterior-quick-opening">
          <span className="exterior-row-label">{OPENING_LABEL[o.kind]}</span>
          <div className="option-group" role="group" aria-label={`${OPENING_LABEL[o.kind]}: which wall`}>
            {QUICK_WALLS.map((name, i) => (
              <button key={name} type="button" className={`option-btn${o.wall === i ? " selected" : ""}`} aria-pressed={o.wall === i} onClick={() => set(o.id, (x) => ({ ...x, wall: i }))}>
                {name}
              </button>
            ))}
          </div>
          <FeetInput label={`${OPENING_LABEL[o.kind]}: width`} value={o.widthFeet} onCommit={(v) => v !== null && set(o.id, (x) => ({ ...x, widthFeet: v }))} />
          <span aria-hidden="true">×</span>
          <FeetInput label={`${OPENING_LABEL[o.kind]}: height`} value={o.heightFeet} onCommit={(v) => v !== null && set(o.id, (x) => ({ ...x, heightFeet: v }))} />
          <button type="button" className="btn-secondary exterior-row-x" aria-label={`Take the ${OPENING_LABEL[o.kind].toLowerCase()} off`} onClick={() => setOpenings((list) => list.filter((x) => x.id !== o.id))}>
            ×
          </button>
        </div>
      ))}
      <div className="exterior-row">
        {(["door", "window", "garage"] as const).map((kind) => (
          <button key={kind} type="button" className="btn-secondary" onClick={() => add(kind)}>
            + {OPENING_LABEL[kind]}
          </button>
        ))}
      </div>
      {problem && <p className="sketch-length-error">{problem}</p>}
      <button type="button" className="btn-primary" onClick={make}>
        Make {the}
      </button>
    </div>
  );
}
