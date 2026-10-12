"use client";

import { useId, useState } from "react";
import {
  DEFAULT_EQUIPMENT_SETTINGS,
  DEHUMIDIFIER_SIZES,
  DEHUMIDIFIER_TYPE_LABEL,
  type DehumidifierType,
  type EquipmentSettings,
  type UnitSize,
  type WaterClass,
} from "@/lib/equipment";
import { type DryingRoom, type RoomDryingPlan, dryingPlan, hasWetArea, rectangleRoom } from "@/lib/dryingPlan";
import { formatFeetInches, parseFeetInches } from "@/lib/sketch";

/**
 * The public drying calculator: rooms typed in as length x width x height, which walls are wet and how
 * much of the floor and ceiling, and back come the air movers, the dehumidifiers and where they go.
 *
 * A front on lib/dryingPlan.ts and nothing more. Every number on this page comes out of the engine
 * the sketch's equipment panel runs, so a room typed in here and the same room marked up on a claim
 * get the same count; when Scan sends moisture maps, the same engine counts and lays out from those.
 */

type Walls = [boolean, boolean, boolean, boolean];

interface RoomRow {
  key: number;
  name: string;
  length: string;
  width: string;
  height: string;
  walls: Walls;
  wetHeight: string;
  floor: number;
  ceiling: number;
  insets: string;
}

const WALL_NAMES = ["Top", "Right", "Bottom", "Left"] as const;

const SHARES: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
  { value: 1, label: "All" },
];

const CLASS_LABEL: Record<WaterClass, string> = {
  1: "Class 1 — part of a room",
  2: "Class 2 — a whole room",
  3: "Class 3 — saturated",
  4: "Class 4 — specialty drying",
};

function newRoom(key: number): RoomRow {
  return {
    key,
    name: `Room ${key}`,
    length: "12",
    width: "10",
    height: "8",
    walls: [true, true, true, true],
    wetHeight: "2",
    floor: 1,
    ceiling: 0,
    insets: "0",
  };
}

/** The row as the engine takes it, or null while its size is not a size yet. */
function toDryingRoom(row: RoomRow): DryingRoom | null {
  const length = parseFeetInches(row.length);
  const width = parseFeetInches(row.width);
  const height = parseFeetInches(row.height);
  if (!length || !width || !height) return null;
  return rectangleRoom({
    id: String(row.key),
    name: row.name,
    lengthFeet: length,
    widthFeet: width,
    heightFeet: height,
    wetWalls: row.walls,
    wetHeightFeet: parseFeetInches(row.wetHeight) ?? 0,
    wetFloorShare: row.floor,
    wetCeilingShare: row.ceiling,
    insetsOver18Inches: Math.floor(Number(row.insets) || 0),
  });
}

export function DryingCalculator() {
  const [settings, setSettings] = useState<EquipmentSettings>(DEFAULT_EQUIPMENT_SETTINGS);
  const [rows, setRows] = useState<RoomRow[]>(() => [newRoom(1)]);
  const ids = useId();

  const typed = rows.map((row) => ({ row, room: toDryingRoom(row) }));
  const wet = typed.flatMap(({ room }) => (room && hasWetArea(room) ? [room] : []));
  const plan = dryingPlan(wet, settings);
  const planFor = (key: number) => plan.rooms.find((r) => r.roomId === String(key)) ?? null;

  const update = (key: number, patch: Partial<RoomRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRoom = () => setRows((all) => [...all, newRoom(Math.max(0, ...all.map((r) => r.key)) + 1)]);
  const removeRoom = (key: number) => setRows((all) => all.filter((r) => r.key !== key));

  const dehu = plan.dehumidifiers;
  const band = DEHUMIDIFIER_SIZES[settings.dehumidifierType][settings.dehumidifierSize];

  return (
    <div className="mk-form mk-calc">
      <div className="mk-calc-settings">
        <div className="mk-field">
          <label htmlFor={`${ids}-class`}>Water class</label>
          <select
            id={`${ids}-class`}
            value={settings.waterClass}
            onChange={(e) => setSettings({ ...settings, waterClass: Number(e.target.value) as WaterClass })}
          >
            {([1, 2, 3, 4] as WaterClass[]).map((c) => (
              <option key={c} value={c}>
                {CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-field">
          <label htmlFor={`${ids}-type`}>Dehumidifier</label>
          <select
            id={`${ids}-type`}
            value={settings.dehumidifierType}
            onChange={(e) => setSettings({ ...settings, dehumidifierType: e.target.value as DehumidifierType })}
          >
            {(Object.keys(DEHUMIDIFIER_TYPE_LABEL) as DehumidifierType[]).map((type) => (
              <option key={type} value={type}>
                {DEHUMIDIFIER_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-field">
          <label htmlFor={`${ids}-size`}>Unit size</label>
          <select
            id={`${ids}-size`}
            value={settings.dehumidifierSize}
            onChange={(e) => setSettings({ ...settings, dehumidifierSize: e.target.value as UnitSize })}
          >
            {(["small", "medium", "large"] as UnitSize[]).map((size) => (
              <option key={size} value={size}>
                {DEHUMIDIFIER_SIZES[settings.dehumidifierType][size].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {typed.map(({ row, room }) => (
        <RoomCard
          key={row.key}
          row={row}
          room={room}
          plan={planFor(row.key)}
          onChange={(patch) => update(row.key, patch)}
          onRemove={rows.length > 1 ? () => removeRoom(row.key) : undefined}
        />
      ))}

      <button type="button" className="mk-calc-add" onClick={addRoom}>
        + Add a room
      </button>

      {plan.rooms.length === 0 ? (
        <p className="mk-calc-method">Mark something wet in a room to size the equipment.</p>
      ) : (
        <div className="mk-calc-totals" aria-live="polite">
          <div className="mk-calc-total">
            <span className="num">{plan.totalAirMovers}</span>
            <span className="what">{plan.totalAirMovers === 1 ? "air mover" : "air movers"}</span>
            <span className="note">
              across {plan.rooms.length} wet {plan.rooms.length === 1 ? "room" : "rooms"}
            </span>
          </div>
          <div className="mk-calc-total">
            <span className="num">{dehu.units}</span>
            <span className="what">
              {DEHUMIDIFIER_TYPE_LABEL[settings.dehumidifierType]} {dehu.units === 1 ? "dehumidifier" : "dehumidifiers"}
            </span>
            <span className="note">
              {Math.round(dehu.cubicFeet).toLocaleString()} cu ft → {Math.round(dehu.required).toLocaleString()} {dehu.unit} ÷{" "}
              {band.low.toLocaleString()} {dehu.unit} per unit
            </span>
            {!plan.dehumidifiersPlaced && <span className="note">Desiccants stand outside and duct in, so the plans don&apos;t place them.</span>}
          </div>
        </div>
      )}

      <p className="mk-calc-method">
        <strong>How it&apos;s worked out.</strong> Air movers, per room: 1, plus 1 for every 50 sq ft of wet floor, plus 1 for every 100
        sq ft of wet wall above 2 ft and wet ceiling, plus 1 for each inset or offset over 18&quot;, each part rounded up. Dehumidifiers are sized once
        over all the rooms together, since the air moves between them: LGR at cubic feet ÷ 100, 50 or 40 for class 1, 2 or 3–4;
        desiccant at 1, 2 or 3 air changes an hour; each unit rated at the low end of its size.
      </p>
      <p className="mk-calc-method">
        The plans are a first placement: movers a foot off the wet walls, angled in and all blowing the same way round the room;
        the dehumidifier out in the middle, clear of the walls. A starting point to check your own count against — the tech on site
        makes the call. In Scrivn, the same numbers come straight off the moisture map on your sketch.
      </p>
    </div>
  );
}

function RoomCard({
  row,
  room,
  plan,
  onChange,
  onRemove,
}: {
  row: RoomRow;
  room: DryingRoom | null;
  plan: RoomDryingPlan | null;
  onChange: (patch: Partial<RoomRow>) => void;
  onRemove?: () => void;
}) {
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const badSize = (text: string) => parseFeetInches(text) === null || parseFeetInches(text) === 0;

  return (
    <section className="mk-calc-room" aria-label={row.name || "Room"}>
      <div className="mk-calc-room-head">
        <input aria-label="Room name" value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
        {onRemove && (
          <button type="button" className="mk-calc-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <div className="mk-calc-dims">
        {(
          [
            ["length", "Length"],
            ["width", "Width"],
            ["height", "Height"],
          ] as const
        ).map(([key, label]) => (
          <div className="mk-field" key={key}>
            <label htmlFor={field(key)}>{label} (ft)</label>
            <input
              id={field(key)}
              inputMode="decimal"
              value={row[key]}
              aria-invalid={badSize(row[key]) || undefined}
              onChange={(e) => onChange({ [key]: e.target.value } as Partial<RoomRow>)}
            />
          </div>
        ))}
      </div>

      <div className="mk-calc-body">
        <div className="mk-calc-plan">
          {room ? (
            <RoomPlanDrawing room={room} plan={plan} walls={row.walls} floorWet={row.floor > 0} onToggleWall={(i) => onChange({ walls: row.walls.map((w, j) => (j === i ? !w : w)) as Walls })} />
          ) : (
            <p className="mk-calc-hint">Enter the room&apos;s length, width and height to see it.</p>
          )}
        </div>

        <div className="mk-calc-wet">
          <div className="mk-field">
            <label htmlFor={field("floor")}>Floor wet</label>
            <select id={field("floor")} value={row.floor} onChange={(e) => onChange({ floor: Number(e.target.value) })}>
              {SHARES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mk-field">
            <label htmlFor={field("ceiling")}>Ceiling wet</label>
            <select id={field("ceiling")} value={row.ceiling} onChange={(e) => onChange({ ceiling: Number(e.target.value) })}>
              {SHARES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mk-field">
            <label htmlFor={field("wetHeight")}>Walls wet up to (ft)</label>
            <input id={field("wetHeight")} inputMode="decimal" value={row.wetHeight} onChange={(e) => onChange({ wetHeight: e.target.value })} />
          </div>
          <div className="mk-field">
            <label htmlFor={field("insets")}>Insets over 18&quot;</label>
            <input id={field("insets")} inputMode="numeric" value={row.insets} onChange={(e) => onChange({ insets: e.target.value })} />
          </div>
        </div>
      </div>

      <p className="mk-calc-result">
        {!room ? (
          "Enter the length, width and height."
        ) : !plan ? (
          "Nothing marked wet yet: tap a wall on the plan, or set a wet floor or ceiling."
        ) : (
          <>
            <strong>
              {plan.airMovers.units} {plan.airMovers.units === 1 ? "air mover" : "air movers"}
            </strong>
            : 1 base + {plan.airMovers.breakdown.floor} floor + {plan.airMovers.breakdown.upper} walls &amp; ceiling
            {plan.airMovers.breakdown.insets > 0 && <> + {plan.airMovers.breakdown.insets} insets</>}
            {plan.dehumidifierUnits > 0 && (
              <>
                {" "}
                · <strong>{plan.dehumidifierUnits}</strong> {plan.dehumidifierUnits === 1 ? "dehumidifier" : "dehumidifiers"} here
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}

/* ── The plan drawing ──────────────────────────────────────────────────────────────────────────── */

const VIEW_W = 260;
const VIEW_H = 200;
const PAD = 26;
const WET = "#b3382c";
const DRY = "#5b6b7c";
const MOVER = "#1b3a5c";
const DEHU = "#c97a0e";

/**
 * The room to scale, with the walls as the wet/dry switches and the plan's equipment drawn on it.
 *
 * Only rectangles reach here: the calculator types rooms in as length x width. The walls are real
 * buttons to a keyboard and a screen reader — each one a checkbox — not just shapes that happen to
 * take a click.
 */
function RoomPlanDrawing({
  room,
  plan,
  walls,
  floorWet,
  onToggleWall,
}: {
  room: DryingRoom;
  plan: RoomDryingPlan | null;
  walls: Walls;
  floorWet: boolean;
  onToggleWall: (wall: number) => void;
}) {
  const corners = room.outline;
  const length = Math.max(...corners.map((p) => p.x));
  const width = Math.max(...corners.map((p) => p.y));
  const scale = Math.min((VIEW_W - 2 * PAD) / length, (VIEW_H - 2 * PAD) / width);
  const ox = (VIEW_W - length * scale) / 2;
  const oy = (VIEW_H - width * scale) / 2;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;
  const unplaced = plan?.airMoversUnplaced ?? 0;

  return (
    <>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="group" aria-label={`Plan of ${room.name}. Tap a wall to mark it wet or dry.`}>
        <rect x={X(0)} y={Y(0)} width={length * scale} height={width * scale} fill={floorWet ? "rgba(242, 193, 78, 0.22)" : "#f4f7fa"} />

        <text x={X(length / 2)} y={Y(0) - 9} textAnchor="middle" className="mk-calc-dim">
          {formatFeetInches(length)}
        </text>
        <text x={X(0) - 9} y={Y(width / 2)} textAnchor="middle" className="mk-calc-dim" transform={`rotate(-90 ${X(0) - 9} ${Y(width / 2)})`}>
          {formatFeetInches(width)}
        </text>

        {corners.map((a, i) => {
          const b = corners[(i + 1) % corners.length] ?? a;
          const wet = walls[i] ?? false;
          return (
            <line key={`wall-${i}`} x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke={wet ? WET : DRY} strokeWidth={wet ? 5 : 2.5} strokeLinecap="square" />
          );
        })}

        {plan?.dehumidifierSpots.map((s, i) => {
          const along = s.headingDeg === 0;
          const w = along ? 20 : 14;
          const h = along ? 14 : 20;
          return (
            <g key={`dehu-${i}`} aria-hidden="true">
              <rect x={X(s.x) - w / 2} y={Y(s.y) - h / 2} width={w} height={h} rx={2} fill={DEHU} />
              <text x={X(s.x)} y={Y(s.y) + 3.5} textAnchor="middle" className="mk-calc-dehu-mark">
                D
              </text>
            </g>
          );
        })}

        {plan?.airMoverSpots.map((s, i) => (
          <path key={`mover-${i}`} d="M 8 0 L -5 -5.5 L -2.5 0 L -5 5.5 Z" fill={MOVER} transform={`translate(${X(s.x)} ${Y(s.y)}) rotate(${s.headingDeg})`} aria-hidden="true" />
        ))}

        {corners.map((a, i) => {
          const b = corners[(i + 1) % corners.length] ?? a;
          const wet = walls[i] ?? false;
          const toggle = () => onToggleWall(i);
          return (
            <line
              key={`hit-${i}`}
              className="mk-calc-wallhit"
              x1={X(a.x)}
              y1={Y(a.y)}
              x2={X(b.x)}
              y2={Y(b.y)}
              role="checkbox"
              aria-checked={wet}
              aria-label={`${WALL_NAMES[i]} wall wet`}
              tabIndex={0}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }}
            />
          );
        })}
      </svg>
      <div className="mk-calc-legend" aria-hidden="true">
        <span>
          <svg viewBox="-8 -7 17 14" width="14" height="12">
            <path d="M 8 0 L -5 -5.5 L -2.5 0 L -5 5.5 Z" fill={MOVER} />
          </svg>{" "}
          Air mover
        </span>
        <span>
          <svg viewBox="0 0 14 10" width="14" height="10">
            <rect width="14" height="10" rx="2" fill={DEHU} />
          </svg>{" "}
          Dehumidifier
        </span>
        <span>
          <svg viewBox="0 0 16 6" width="16" height="6">
            <line x1="0" y1="3" x2="16" y2="3" stroke={WET} strokeWidth="5" />
          </svg>{" "}
          Wet wall — tap to change
        </span>
      </div>
      {unplaced > 0 && (
        <p className="mk-calc-hint">
          +{unplaced} more {unplaced === 1 ? "mover" : "movers"} than the walls have room for: set {unplaced === 1 ? "it" : "them"} out on the open floor.
        </p>
      )}
    </>
  );
}
