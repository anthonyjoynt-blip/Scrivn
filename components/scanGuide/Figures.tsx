/**
 * The tester guide's own drawings (/scan-guide): the screens of Scrivn Scan, drawn rather than
 * photographed so nobody's house is in them and so they stay true when the camera image would not.
 * Every label in them is the app's own word (res/values/strings.xml). The how-to drawings the app
 * itself shows are in public/scan-guide (scripts/howto-svgs.py).
 *
 * Static SVG, no state: each figure is described in words by the guide around it, so the drawings
 * are aria-hidden and the text carries the meaning.
 */

import { HOWTO_DRAWINGS, type HowtoName } from "./howtoDrawings";

const NAVY = "#1b3a5c";
const NAVY_DARK = "#12283f";
// The ring and chip colours are the app's own (MainActivity RETICLE_*, CHIP_ON/OFF); amber is also the site's.
const AMBER = "#f5b942";
const GREEN = "#33e06a";
const RED = "#e0453a";
const GREY = "#9aa3ad";
const CHIP_OFF = "#3a3f47";
const CHROME = "#0b0d10";
const PAPER = "#ffffff";
const MUTED = "#5b6b7c";
const INK = "#1a2430";

function Callout({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={AMBER} stroke={PAPER} strokeWidth={2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={NAVY_DARK}>
        {n}
      </text>
    </g>
  );
}

function Chip({ x, y, w, label, lit = false }: { x: number; y: number; w: number; label: string; lit?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={26} rx={13} fill={lit ? GREEN : CHIP_OFF} />
      <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={lit ? CHROME : PAPER}>
        {label}
      </text>
    </g>
  );
}

/** The capture screen, with the six things on it numbered. */
export function CaptureScreen() {
  return (
    <svg viewBox="0 0 300 600" role="img" aria-hidden="true" className="sg-svg sg-phone">
      <defs>
        <linearGradient id="sg-cam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9d3c8" />
          <stop offset="1" stopColor="#a8a092" />
        </linearGradient>
      </defs>
      <rect x={8} y={8} width={284} height={584} rx={38} fill={NAVY_DARK} />
      <rect x={20} y={30} width={260} height={540} rx={26} fill="url(#sg-cam)" />
      {/* the room the camera sees: two walls meeting at a corner, the floor */}
      <polygon points="20,60 150,120 150,330 20,400" fill="#e6e0d6" />
      <polygon points="150,120 280,60 280,400 150,330" fill="#d6cfc3" />
      <polygon points="20,400 150,330 280,400 280,570 20,570" fill="#b9ad9b" />
      <line x1={150} y1={120} x2={150} y2={330} stroke="#8d8577" strokeWidth={1.5} />
      {/* Stop */}
      <rect x={32} y={44} width={58} height={30} rx={15} fill="rgba(18,40,63,0.85)" />
      <text x={61} y={64} textAnchor="middle" fontSize={12} fontWeight={600} fill={PAPER}>
        Stop
      </text>
      {/* the mini-map */}
      <rect x={196} y={44} width={70} height={70} rx={8} fill={PAPER} stroke={NAVY} strokeWidth={1} />
      <polyline points="210,96 210,60 250,60 250,82" fill="none" stroke={NAVY} strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={232} cy={86} r={3.5} fill={AMBER} />
      {/* the ring, green: a tap will read */}
      <circle cx={150} cy={230} r={24} fill="none" stroke={GREEN} strokeWidth={5} />
      <circle cx={150} cy={230} r={2.5} fill={GREEN} />
      {/* the line */}
      <rect x={34} y={380} width={232} height={30} rx={8} fill="rgba(18,40,63,0.85)" />
      <text x={150} y={400} textAnchor="middle" fontSize={12} fill={PAPER}>
        Corner 2 · wall 1: 12&apos;6&quot;
      </text>
      {/* the chip bar */}
      <rect x={20} y={440} width={260} height={130} fill="rgba(18,40,63,0.92)" />
      <Chip x={28} y={452} w={48} label="Corner" lit />
      <Chip x={80} y={452} w={36} label="Door" />
      <Chip x={120} y={452} w={50} label="Opening" />
      <Chip x={174} y={452} w={46} label="Window" />
      <Chip x={224} y={452} w={48} label="More…" />
      <Chip x={28} y={488} w={50} label="Undo" />
      <Chip x={82} y={488} w={42} label="360°" />
      <Chip x={128} y={488} w={30} label="?" />
      <Chip x={162} y={488} w={74} label="Add room" />
      <Callout x={34} y={44} n={1} />
      <Callout x={196} y={44} n={2} />
      <Callout x={180} y={206} n={3} />
      <Callout x={34} y={380} n={4} />
      <Callout x={22} y={452} n={5} />
      <Callout x={22} y={500} n={6} />
    </svg>
  );
}

/** One ring, in one of its colours, with the word the app puts under it. */
export function Ring({ colour, hint }: { colour: "grey" | "red" | "amber" | "green"; hint?: string }) {
  const stroke = colour === "grey" ? GREY : colour === "red" ? RED : colour === "amber" ? AMBER : GREEN;
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className="sg-svg sg-ring">
      <rect x={0} y={0} width={80} height={80} rx={12} fill="#cfc8bc" />
      <circle cx={40} cy={34} r={17} fill="none" stroke={stroke} strokeWidth={4.5} />
      {hint && (
        <text x={40} y={70} textAnchor="middle" fontSize={10} fontWeight={600} fill={NAVY_DARK}>
          {hint}
        </text>
      )}
    </svg>
  );
}

/** Two rooms and the doorway between them, tapped from each side; then the join. */
export function JoinRooms() {
  return (
    <svg viewBox="0 0 360 220" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={220} rx={10} fill="#f7f9fb" />
      {/* Room 1 */}
      <rect x={20} y={30} width={150} height={150} fill="none" stroke={NAVY} strokeWidth={3} />
      {/* Room 2, the doorway in the shared wall */}
      <polyline points="174,104 174,50 330,50 330,180 174,180 174,140" fill="none" stroke={NAVY} strokeWidth={3} />
      <line x1={170} y1={104} x2={170} y2={140} stroke="#f7f9fb" strokeWidth={5} />
      <text x={95} y={160} textAnchor="middle" fontSize={13} fontWeight={700} fill={MUTED}>
        Room 1
      </text>
      <text x={262} y={90} textAnchor="middle" fontSize={13} fontWeight={700} fill={MUTED}>
        Room 2
      </text>
      {/* the doorway ringed as the join shows it */}
      <rect x={160} y={96} width={24} height={52} rx={6} fill="none" stroke={AMBER} strokeWidth={2} strokeDasharray="4 3" />
      {/* Room 1 taps its side */}
      <circle cx={165} cy={104} r={5} fill={NAVY} />
      <circle cx={165} cy={140} r={5} fill={NAVY} />
      <line x1={70} y1={75} x2={162} y2={104} stroke={NAVY} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={70} y1={75} x2={162} y2={140} stroke={NAVY} strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={70} cy={75} r={7} fill={NAVY} />
      {/* Room 2 taps its side */}
      <circle cx={179} cy={104} r={5} fill={AMBER} />
      <circle cx={179} cy={140} r={5} fill={AMBER} />
      <line x1={270} y1={150} x2={182} y2={104} stroke={AMBER} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={270} y1={150} x2={182} y2={140} stroke={AMBER} strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={270} cy={150} r={7} fill={AMBER} />
      <text x={20} y={205} fontSize={11} fill={INK}>
        Room 1&apos;s side: its two jambs
      </text>
      <text x={340} y={205} textAnchor="end" fontSize={11} fill={INK}>
        Room 2&apos;s side, then Join here
      </text>
    </svg>
  );
}

/** The mini-map after a drop: the corner to tap again, ringed in orange, and the line asking for it. */
export function DropAsk() {
  return (
    <svg viewBox="0 0 300 190" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={300} height={190} rx={10} fill="#a8a092" />
      <rect x={90} y={14} width={120} height={110} rx={10} fill={PAPER} stroke={NAVY} strokeWidth={1} />
      <polygon points="108,34 192,34 192,104 108,104" fill="none" stroke={NAVY} strokeWidth={2.5} />
      {[
        [108, 34, "1"],
        [192, 34, "2"],
        [192, 104, "3"],
        [108, 104, "4"],
      ].map(([x, y, n]) => (
        <g key={n as string}>
          <circle cx={x as number} cy={y as number} r={4} fill={NAVY} />
          <text x={(x as number) + ((x as number) > 150 ? 9 : -9)} y={(y as number) + ((y as number) > 60 ? 14 : -6)} textAnchor="middle" fontSize={10} fill={NAVY}>
            {n}
          </text>
        </g>
      ))}
      <circle cx={192} cy={104} r={11} fill="none" stroke={AMBER} strokeWidth={3} />
      <rect x={14} y={140} width={272} height={36} rx={8} fill="rgba(18,40,63,0.9)" />
      <text x={150} y={163} textAnchor="middle" fontSize={11.5} fill={PAPER}>
        Tap corner 3 again — ringed in orange on the map
      </text>
    </svg>
  );
}

/** Review: the plan, a length typed from the tape, the room row, and Report a problem in the corner. */
export function ReviewScreen() {
  return (
    <svg viewBox="0 0 300 600" aria-hidden="true" className="sg-svg sg-phone">
      <rect x={8} y={8} width={284} height={584} rx={38} fill={NAVY_DARK} />
      <rect x={20} y={30} width={260} height={540} rx={26} fill={PAPER} />
      <text x={36} y={70} fontSize={19} fontWeight={700} fill={NAVY}>
        Review
      </text>
      <text x={264} y={68} textAnchor="end" fontSize={11.5} fill={NAVY}>
        Report a problem
      </text>
      <rect x={168} y={52} width={104} height={24} rx={12} fill="none" stroke={AMBER} strokeWidth={2} />
      {/* the plan */}
      <polygon points="60,130 240,130 240,330 150,330 150,380 60,380" fill="#f2f5f8" stroke={NAVY} strokeWidth={3} />
      <rect x={124} y={118} width={52} height={22} rx={11} fill={PAPER} stroke={NAVY} strokeWidth={1} />
      <text x={150} y={133} textAnchor="middle" fontSize={11} fill={NAVY}>
        15&apos;0&quot;
      </text>
      <rect x={210} y={218} width={56} height={22} rx={11} fill={PAPER} stroke={NAVY} strokeWidth={1} />
      <text x={238} y={233} textAnchor="middle" fontSize={11} fill={NAVY}>
        16&apos;8&quot;
      </text>
      {/* a typed length: the phone's reading struck through, the tape in amber */}
      <rect x={24} y={240} width={78} height={40} rx={10} fill="#fbeeda" stroke={AMBER} strokeWidth={1.5} />
      <text x={63} y={256} textAnchor="middle" fontSize={10} fill={MUTED}>
        12&apos;4&quot;
      </text>
      <line x1={48} y1={252} x2={78} y2={252} stroke={MUTED} strokeWidth={1} />
      <text x={63} y={273} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#c97a0e">
        → 12&apos;6&quot;
      </text>
      <text x={150} y={250} textAnchor="middle" fontSize={13} fontWeight={600} fill={MUTED}>
        Kitchen
      </text>
      {/* the room row */}
      <rect x={34} y={430} width={110} height={34} rx={8} fill={PAPER} stroke={NAVY} strokeWidth={1.2} />
      <text x={89} y={452} textAnchor="middle" fontSize={11.5} fill={NAVY}>
        Kitchen
      </text>
      <rect x={156} y={430} width={110} height={34} rx={8} fill={PAPER} stroke={NAVY} strokeWidth={1.2} />
      <text x={211} y={452} textAnchor="middle" fontSize={11.5} fill={NAVY}>
        Ceiling 8&apos;1&quot;
      </text>
      {/* the buttons */}
      <rect x={34} y={500} width={110} height={36} rx={8} fill={PAPER} stroke={NAVY} strokeWidth={1.2} />
      <text x={89} y={523} textAnchor="middle" fontSize={12} fill={NAVY}>
        Undo last
      </text>
      <rect x={156} y={500} width={110} height={36} rx={8} fill={NAVY} />
      <text x={211} y={523} textAnchor="middle" fontSize={12} fontWeight={600} fill={PAPER}>
        Close
      </text>
    </svg>
  );
}

/** The Send to Scrivn team box. */
export function ReportDialog() {
  return (
    <svg viewBox="0 0 300 320" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={300} height={320} rx={12} fill="#cfd6de" />
      <rect x={16} y={16} width={268} height={288} rx={12} fill={PAPER} />
      <text x={34} y={50} fontSize={16} fontWeight={700} fill={INK}>
        Send to Scrivn team
      </text>
      {["Sends this scan and the app's log of it to", "the Scrivn team so we can see what went", "wrong. No photos are sent."].map((line, i) => (
        <text key={line} x={34} y={78 + i * 17} fontSize={11.5} fill={MUTED}>
          {line}
        </text>
      ))}
      <line x1={34} y1={176} x2={266} y2={176} stroke={NAVY} strokeWidth={1.5} />
      <text x={34} y={150} fontSize={11.5} fill={INK}>
        Bedroom 2, wall 3 came in 6 in short.
      </text>
      <text x={34} y={168} fontSize={11.5} fill={INK}>
        Tape says 11&apos;2&quot;.
      </text>
      <line x1={34} y1={226} x2={266} y2={226} stroke={GREY} strokeWidth={1.5} />
      <text x={34} y={218} fontSize={11.5} fill={GREY}>
        Your name or email (optional)
      </text>
      <text x={180} y={278} fontSize={13} fontWeight={600} fill={NAVY}>
        CANCEL
      </text>
      <text x={250} y={278} fontSize={13} fontWeight={600} fill={NAVY}>
        SEND
      </text>
    </svg>
  );
}

/** A 360 from above: twelve dots round the level, six on the floor; turn on the spot. */
export function SpinDots() {
  const level = Array.from({ length: 12 }, (_, k) => {
    const a = (k * 30 - 90) * (Math.PI / 180);
    return { x: 110 + 78 * Math.cos(a), y: 110 + 78 * Math.sin(a), k };
  });
  const floor = Array.from({ length: 6 }, (_, k) => {
    const a = (k * 60 - 90) * (Math.PI / 180);
    return { x: 110 + 38 * Math.cos(a), y: 110 + 38 * Math.sin(a), k };
  });
  return (
    <svg viewBox="0 0 360 230" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={230} rx={10} fill="#f7f9fb" />
      {level.map(({ x, y, k }) =>
        k < 4 ? (
          <g key={`l${k}`}>
            <circle cx={x} cy={y} r={9} fill={GREEN} />
            <path d={`M${x - 4},${y} l3,3 l5,-6`} fill="none" stroke={PAPER} strokeWidth={2} strokeLinecap="round" />
          </g>
        ) : k === 4 ? (
          <circle key={`l${k}`} cx={x} cy={y} r={9} fill={AMBER} />
        ) : (
          <circle key={`l${k}`} cx={x} cy={y} r={8} fill="none" stroke={GREY} strokeWidth={2} />
        ),
      )}
      {floor.map(({ x, y, k }) => (
        <circle key={`f${k}`} cx={x} cy={y} r={6} fill="none" stroke={GREY} strokeWidth={1.6} strokeDasharray="2 2" />
      ))}
      <circle cx={110} cy={110} r={10} fill={NAVY} />
      <path d="M150,40 A78,78 0 0 1 186,66" fill="none" stroke={NAVY} strokeWidth={2} markerEnd="url(#sg-arrow)" />
      <defs>
        <marker id="sg-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={NAVY} />
        </marker>
      </defs>
      <circle cx={222} cy={44} r={7} fill={GREEN} />
      <text x={236} y={48} fontSize={11} fill={INK}>
        taken
      </text>
      <circle cx={222} cy={74} r={7} fill={AMBER} />
      <text x={236} y={78} fontSize={11} fill={INK}>
        next: hold the ring on it
      </text>
      <circle cx={222} cy={104} r={6} fill="none" stroke={GREY} strokeWidth={2} />
      <text x={236} y={108} fontSize={11} fill={INK}>
        still to come
      </text>
      <circle cx={222} cy={134} r={5} fill="none" stroke={GREY} strokeWidth={1.6} strokeDasharray="2 2" />
      <text x={236} y={138} fontSize={11} fill={INK}>
        then the floor ring
      </text>
      <text x={236} y={154} fontSize={11} fill={INK}>
        (tilt down)
      </text>
      <text x={110} y={218} textAnchor="middle" fontSize={11} fill={MUTED}>
        Seen from above: you turn on the spot
      </text>
    </svg>
  );
}

/** The closets step: the dashed Closet? box behind a closet door, and the same box tapped. */
export function ClosetStep() {
  return (
    <svg viewBox="0 0 360 190" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={190} rx={10} fill="#f7f9fb" />
      {[0, 1].map((side) => {
        const ox = side * 180;
        return (
          <g key={side}>
            <rect x={ox + 20} y={60} width={140} height={100} fill="none" stroke={NAVY} strokeWidth={3} />
            <line x1={ox + 70} y1={60} x2={ox + 110} y2={60} stroke="#f7f9fb" strokeWidth={5} />
            <line x1={ox + 70} y1={60} x2={ox + 90} y2={46} stroke={NAVY} strokeWidth={1.5} />
            <line x1={ox + 110} y1={60} x2={ox + 90} y2={46} stroke={NAVY} strokeWidth={1.5} />
            {side === 0 ? (
              <>
                <rect x={ox + 40} y={20} width={100} height={36} fill="#fbeeda" fillOpacity={0.6} stroke={AMBER} strokeWidth={2} strokeDasharray="5 4" />
                <text x={ox + 90} y={42} textAnchor="middle" fontSize={12} fontWeight={700} fill="#c97a0e">
                  Closet?
                </text>
              </>
            ) : (
              <>
                <rect x={ox + 40} y={20} width={100} height={36} fill="#e8eef4" stroke={NAVY} strokeWidth={2.5} />
                <text x={ox + 90} y={42} textAnchor="middle" fontSize={12} fontWeight={700} fill={NAVY}>
                  Closet
                </text>
              </>
            )}
            <text x={ox + 90} y={120} textAnchor="middle" fontSize={12} fill={MUTED}>
              Bedroom
            </text>
            <text x={ox + 90} y={180} textAnchor="middle" fontSize={11} fill={INK}>
              {side === 0 ? "Asked before Send" : "Tapped: drawn in"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** One of the app's own how-to drawings, inline (scripts/howto-svgs.py). */
export function HowtoArt({ name }: { name: HowtoName }) {
  const art = HOWTO_DRAWINGS[name];
  return (
    <svg viewBox={art.viewBox} aria-hidden="true" className="sg-svg sg-howto">
      {art.paths.map((p, i) => (
        <path key={i} {...p} />
      ))}
    </svg>
  );
}
