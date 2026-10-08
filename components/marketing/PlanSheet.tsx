/**
 * What Scrivn Scan hands you, drawn: a floor plan sheet in the style of the app's Share PDF — walls
 * drawn solid, doors with their swings, a bifold closet, windows, room names and sizes, the overall
 * dimensions and a scale bar. An illustration for the /scan page, not a capture: no real house.
 *
 * Laid out in feet at 12 px a foot (a quarter inch to the foot on a 96 dpi sheet, near enough), so the
 * sizes written in it are the sizes drawn. Aria-hidden: the page around it says what it shows.
 */

const INK = "#1a2430";
const NAVY = "#1b3a5c";
const MUTED = "#5b6b7c";
const PAPER = "#ffffff";
const LINE = "#d7dfe7";

const X0 = 52;
const Y0 = 84;
const FT = 12;
const fx = (ft: number) => X0 + ft * FT;
const fy = (ft: number) => Y0 + ft * FT;

/** Rooms in feet: left, top, right, bottom. */
const ROOMS = [
  { name: "Living room", size: "16'0\" × 14'0\"", box: [0, 0, 16, 14] },
  { name: "Kitchen", size: "12'0\" × 14'0\"", box: [16, 0, 28, 14] },
  { name: "Bedroom", size: "12'0\" × 11'0\"", box: [0, 14, 12, 25] },
  { name: "Bath", size: "8'0\" × 7'0\"", box: [12, 14, 20, 21] },
  { name: "Closet", size: "8'0\" × 4'0\"", box: [12, 21, 20, 25], small: true },
] as const;

/** Windows on outside walls: [x or y of the wall, from, to, "h" along a horizontal wall | "v" along a vertical one], in feet. */
const WINDOWS = [
  [0, 4, 10, "h"],
  [0, 19, 25, "h"],
  [28, 4, 9, "v"],
  [0, 17, 21, "v"],
] as const;

function Window({ at, from, to, dir }: { at: number; from: number; to: number; dir: "h" | "v" }) {
  if (dir === "h") {
    const y = fy(at);
    return (
      <g>
        <rect x={fx(from)} y={y - 3} width={(to - from) * FT} height={6} fill={PAPER} stroke={INK} strokeWidth={1} />
        <line x1={fx(from)} y1={y} x2={fx(to)} y2={y} stroke={INK} strokeWidth={1} />
      </g>
    );
  }
  const x = fx(at);
  return (
    <g>
      <rect x={x - 3} y={fy(from)} width={6} height={(to - from) * FT} fill={PAPER} stroke={INK} strokeWidth={1} />
      <line x1={x} y1={fy(from)} x2={x} y2={fy(to)} stroke={INK} strokeWidth={1} />
    </g>
  );
}

export function PlanSheet({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 440 434" aria-hidden="true" className={className}>
      <rect x={10} y={10} width={420} height={414} rx={4} fill={PAPER} stroke={LINE} />

      {/* title block */}
      <text x={X0} y={42} fontSize={13} fontWeight={700} fill={NAVY}>
        Main floor
      </text>
      <text x={fx(28)} y={42} textAnchor="end" fontSize={10} fill={MUTED}>
        Scale ¼″ = 1′0″
      </text>

      {/* overall dimensions */}
      <line x1={fx(0)} y1={70} x2={fx(28)} y2={70} stroke={MUTED} strokeWidth={0.8} />
      <line x1={fx(0)} y1={65} x2={fx(0)} y2={75} stroke={MUTED} strokeWidth={0.8} />
      <line x1={fx(28)} y1={65} x2={fx(28)} y2={75} stroke={MUTED} strokeWidth={0.8} />
      <text x={fx(14)} y={64} textAnchor="middle" fontSize={10} fill={MUTED}>
        28&apos;0&quot;
      </text>
      <line x1={36} y1={fy(0)} x2={36} y2={fy(25)} stroke={MUTED} strokeWidth={0.8} />
      <line x1={31} y1={fy(0)} x2={41} y2={fy(0)} stroke={MUTED} strokeWidth={0.8} />
      <line x1={31} y1={fy(25)} x2={41} y2={fy(25)} stroke={MUTED} strokeWidth={0.8} />
      <text x={30} y={fy(12.5)} textAnchor="middle" fontSize={10} fill={MUTED} transform={`rotate(-90 30 ${fy(12.5)})`}>
        25&apos;0&quot;
      </text>

      {/* walls: every room's outline, so a shared wall is drawn once over itself */}
      {ROOMS.map((r) => (
        <rect
          key={r.name}
          x={fx(r.box[0])}
          y={fy(r.box[1])}
          width={(r.box[2] - r.box[0]) * FT}
          height={(r.box[3] - r.box[1]) * FT}
          fill="none"
          stroke={INK}
          strokeWidth={4}
        />
      ))}

      {/* the front door, swinging in */}
      <rect x={fx(0) - 3} y={fy(5)} width={6} height={3 * FT} fill={PAPER} />
      <line x1={fx(0)} y1={fy(5)} x2={fx(3)} y2={fy(5)} stroke={INK} strokeWidth={1.4} />
      <path d={`M ${fx(3)} ${fy(5)} A ${3 * FT} ${3 * FT} 0 0 1 ${fx(0)} ${fy(8)}`} fill="none" stroke={INK} strokeWidth={0.8} />

      {/* a cased opening between living room and kitchen */}
      <rect x={fx(16) - 3} y={fy(4)} width={6} height={6 * FT} fill={PAPER} />

      {/* bedroom and bath doors */}
      <rect x={fx(8.5)} y={fy(14) - 3} width={2.5 * FT} height={6} fill={PAPER} />
      <line x1={fx(11)} y1={fy(14)} x2={fx(11)} y2={fy(16.5)} stroke={INK} strokeWidth={1.4} />
      <path d={`M ${fx(11)} ${fy(16.5)} A ${2.5 * FT} ${2.5 * FT} 0 0 1 ${fx(8.5)} ${fy(14)}`} fill="none" stroke={INK} strokeWidth={0.8} />
      <rect x={fx(13)} y={fy(14) - 3} width={2.5 * FT} height={6} fill={PAPER} />
      <line x1={fx(13)} y1={fy(14)} x2={fx(13)} y2={fy(16.5)} stroke={INK} strokeWidth={1.4} />
      <path d={`M ${fx(13)} ${fy(16.5)} A ${2.5 * FT} ${2.5 * FT} 0 0 0 ${fx(15.5)} ${fy(14)}`} fill="none" stroke={INK} strokeWidth={0.8} />

      {/* the closet's bifold */}
      <rect x={fx(12) - 3} y={fy(21.5)} width={6} height={3 * FT} fill={PAPER} />
      <polyline
        points={[21.5, 22.25, 23, 23.75, 24.5].map((y, i) => `${fx(12) - (i % 2 ? 12 : 0)},${fy(y)}`).join(" ")}
        fill="none"
        stroke={INK}
        strokeWidth={1.2}
      />

      {WINDOWS.map(([at, from, to, dir]) => (
        <Window key={`${dir}${at}-${from}`} at={at} from={from} to={to} dir={dir} />
      ))}

      {/* names and sizes */}
      {ROOMS.map((r) => {
        const cx = fx((r.box[0] + r.box[2]) / 2);
        const cy = fy((r.box[1] + r.box[3]) / 2) + (r.name === "Bath" ? 8 : 0);
        const small = "small" in r && r.small;
        return (
          <g key={r.name}>
            <text x={cx} y={cy - (small ? 2 : 3)} textAnchor="middle" fontSize={small ? 9 : 11} fontWeight={700} fill={NAVY}>
              {r.name}
            </text>
            <text x={cx} y={cy + (small ? 9 : 11)} textAnchor="middle" fontSize={small ? 8.5 : 10} fill={MUTED}>
              {r.size}
            </text>
          </g>
        );
      })}

      {/* scale bar: 0, 4, 8 ft */}
      <rect x={fx(20)} y={400} width={4 * FT} height={5} fill={INK} />
      <rect x={fx(24)} y={400} width={4 * FT} height={5} fill={PAPER} stroke={INK} strokeWidth={1} />
      <text x={fx(20)} y={416} textAnchor="middle" fontSize={9} fill={MUTED}>
        0
      </text>
      <text x={fx(24)} y={416} textAnchor="middle" fontSize={9} fill={MUTED}>
        4
      </text>
      <text x={fx(28)} y={416} textAnchor="middle" fontSize={9} fill={MUTED}>
        8 ft
      </text>
    </svg>
  );
}
