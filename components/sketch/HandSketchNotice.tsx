"use client";

/**
 * The offer on the claim page when rooms arrive from a hand-drawn sketch (the drop-a-sketch page,
 * lib/handSketchClaim.ts): add them, or not now. The same strip as the scan notice beside it.
 *
 * The floor is asked only when it is a real question — the claim has more than one floor and the one
 * offered first already has rooms on it. Otherwise the rooms go on that floor, said on the button.
 */
export function HandSketchNotice({
  roomCount,
  floors,
  floor,
  floorName,
  onFloor,
  onAdd,
  onNotNow,
}: {
  roomCount: number;
  /** The floors to choose from, lowest first, or null when the floor is not asked. */
  floors: { level: number; name: string }[] | null;
  floor: number;
  /** What `floor` is called; null when the claim has only the one, and the button just says the sketch. */
  floorName: string | null;
  onFloor: (level: number) => void;
  onAdd: () => void;
  onNotNow: () => void;
}) {
  return (
    <div className="sketch-undo scan-inbox-notice hand-sketch-notice" role="status">
      <span>
        {roomCount} room{roomCount === 1 ? "" : "s"} from your hand sketch.
      </span>
      {floors ? (
        <span className="hand-sketch-add">
          <button type="button" className="btn-primary" onClick={onAdd}>
            Add to
          </button>
          <select aria-label="Floor to add the rooms to" value={floor} onChange={(e) => onFloor(Number(e.target.value))}>
            {floors.map((f) => (
              <option key={f.level} value={f.level}>
                {f.name}
              </option>
            ))}
          </select>
        </span>
      ) : (
        <button type="button" className="btn-primary" onClick={onAdd}>
          {floorName ? `Add to ${floorName}` : "Add to the sketch"}
        </button>
      )}
      <button type="button" className="btn-secondary" onClick={onNotNow}>
        Not now
      </button>
    </div>
  );
}
