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

function Chip({ x, y, w, label, lit = false, size = 10.5 }: { x: number; y: number; w: number; label: string; lit?: boolean; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={26} rx={13} fill={lit ? GREEN : CHIP_OFF} />
      <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize={size} fontWeight={600} fill={lit ? CHROME : PAPER}>
        {label}
      </text>
    </g>
  );
}

/** A light dialog of the app's (LIGHT_DIALOG): a white card with its title. */
function Dialog({ w, h, title, children }: { w: number; h: number; title: string; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={w} height={h} rx={12} fill="#cfd6de" />
      <rect x={14} y={14} width={w - 28} height={h - 28} rx={12} fill={PAPER} />
      <text x={32} y={46} fontSize={15} fontWeight={700} fill={INK}>
        {title}
      </text>
      {children}
    </svg>
  );
}

/** A button on a light dialog or Review: navy when chosen, outlined when not. */
function Btn({ x, y, w, label, on = false, h = 30 }: { x: number; y: number; w: number; label: string; on?: boolean; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={on ? NAVY : PAPER} stroke={NAVY} strokeWidth={1.2} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={11.5} fontWeight={on ? 700 : 400} fill={on ? PAPER : NAVY}>
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
      {/* the chip bar: two rows of chips (since 0.1.128), then Undo · ? · Add room */}
      <rect x={20} y={432} width={260} height={138} fill="rgba(18,40,63,0.92)" />
      <Chip x={30} y={440} w={46} label="Corner" lit size={10} />
      <Chip x={80} y={440} w={36} label="Door" size={10} />
      <Chip x={120} y={440} w={50} label="Opening" size={10} />
      <Chip x={174} y={440} w={46} label="Window" size={10} />
      <Chip x={224} y={440} w={44} label="Closet" size={10} />
      <Chip x={30} y={472} w={56} label="Cabinet ▾" size={10} />
      <Chip x={90} y={472} w={52} label="Fixture ▾" size={10} />
      <Chip x={146} y={472} w={42} label="Ceiling" size={10} />
      <Chip x={192} y={472} w={36} label="Stairs" size={10} />
      <Chip x={232} y={472} w={42} label="More…" size={10} />
      <Chip x={30} y={510} w={48} label="Undo" />
      <Chip x={135} y={510} w={30} label="?" />
      <Chip x={198} y={510} w={72} label="Add room" />
      <Callout x={34} y={44} n={1} />
      <Callout x={196} y={44} n={2} />
      <Callout x={180} y={206} n={3} />
      <Callout x={34} y={380} n={4} />
      <Callout x={24} y={440} n={5} />
      <Callout x={24} y={522} n={6} />
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
      {["Sends this scan and the app's recent log –", "earlier runs too – to the Scrivn team so we", "can see what went wrong. No photos are sent."].map((line, i) => (
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

/** A numbered tap, as the guide marks the order of taps. */
function TapMark({ x, y, label, colour = NAVY }: { x: number; y: number; label: string; colour?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={9} fill={colour} stroke={PAPER} strokeWidth={1.5} />
      <text x={x} y={y + 3.8} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={colour === AMBER ? NAVY_DARK : PAPER}>
        {label}
      </text>
    </g>
  );
}

/**
 * One side of the house face-on, as Exterior sketch taps it (Exterior.kt): its two bottom corners first, at the top of
 * the parging and read by depth from 1-3 m; then, aimed, round the stucco and back to the first corner to close it; the
 * parging under it sharing its corners; a window and a door at two opposite corners of their openings. Under it, the
 * exterior capture's row of chips. The roof edge is drawn but never tapped: Scan measures the siding only.
 */
export function ExteriorSide() {
  return (
    <svg viewBox="0 0 360 330" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={330} rx={10} fill="#f7f9fb" />
      <polyline points="22,106 180,36 338,106" fill="none" stroke={GREY} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="40,206 320,206 320,102 180,46 40,102" fill="#ece6da" stroke={NAVY} strokeWidth={2.5} strokeLinejoin="round" />
      <polygon points="40,206 320,206 320,228 40,228" fill="#cbc5ba" stroke={NAVY} strokeWidth={2} />
      <line x1={8} y1={228} x2={352} y2={228} stroke="#8d8577" strokeWidth={1.5} />
      <text x={180} y={98} textAnchor="middle" fontSize={13} fontWeight={700} fill={MUTED}>
        Stucco
      </text>
      <text x={300} y={221} textAnchor="end" fontSize={10.5} fontWeight={600} fill={INK}>
        Parging
      </text>
      {/* a window and a door: their openings in the stucco */}
      <rect x={72} y={118} width={56} height={56} fill="#dfe8f1" stroke={NAVY} strokeWidth={1.5} />
      <rect x={226} y={128} width={40} height={78} fill="#e8eef4" stroke={NAVY} strokeWidth={1.5} />
      <TapMark x={72} y={174} label="a" colour={AMBER} />
      <TapMark x={128} y={118} label="b" colour={AMBER} />
      <TapMark x={226} y={206} label="a" colour={AMBER} />
      <TapMark x={266} y={128} label="b" colour={AMBER} />
      {/* the stucco, round: 1 and 2 fix the wall, 3-5 are aimed, then 1 again closes it */}
      <path d="M48,108 C70,150 70,170 48,196" fill="none" stroke={NAVY} strokeWidth={1.2} strokeDasharray="3 3" />
      <TapMark x={40} y={206} label="1" />
      <TapMark x={320} y={206} label="2" />
      <TapMark x={320} y={102} label="3" />
      <TapMark x={180} y={46} label="4" />
      <TapMark x={40} y={102} label="5" />
      <text x={14} y={250} fontSize={10.5} fill={INK}>
        1, 2: bottom corners, 1–3 m away · 3–5: aimed, then 1 again to close
      </text>
      <text x={14} y={265} fontSize={10.5} fill={INK}>
        a, b: two opposite corners of a window&apos;s or a door&apos;s opening
      </text>
      <rect x={0} y={276} width={360} height={54} rx={10} fill="rgba(18,40,63,0.92)" />
      <Chip x={12} y={290} w={54} label="Stucco" lit />
      <Chip x={70} y={290} w={50} label="Window" />
      <Chip x={124} y={290} w={40} label="Door" />
      <Chip x={168} y={290} w={46} label="Photo" />
      <Chip x={276} y={290} w={72} label="Next side" />
    </svg>
  );
}

/**
 * The lap round the house, seen from above with the front at the bottom (Exterior.footprint): each side taps its own
 * two bottom corners, and a house corner is where two sides' bottom lines cross - so a deck that hides a corner does
 * not matter, the rear's taps stop at the deck and the crossing still finds the corner.
 */
export function ExteriorRound() {
  const stretch = (x1: number, y1: number, x2: number, y2: number) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={NAVY} strokeWidth={5} strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={4.5} fill={NAVY} />
      <circle cx={x2} cy={y2} r={4.5} fill={NAVY} />
    </g>
  );
  return (
    <svg viewBox="0 0 360 260" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={260} rx={10} fill="#f7f9fb" />
      {/* the deck at the rear right, hiding that corner */}
      <rect x={196} y={20} width={84} height={42} fill="#efe4d0" stroke="#c9b48e" strokeWidth={1.5} />
      <text x={238} y={36} textAnchor="middle" fontSize={10.5} fill={MUTED}>
        deck
      </text>
      {/* where the lines are carried on to cross */}
      <path d="M80,62 L280,62 L280,182 L80,182 Z" fill="none" stroke={AMBER} strokeWidth={1.5} strokeDasharray="4 4" />
      {stretch(84, 182, 276, 182)}
      {stretch(280, 178, 280, 70)}
      {stretch(84, 62, 192, 62)}
      {stretch(80, 66, 80, 178)}
      {[
        [80, 62],
        [280, 62],
        [280, 182],
        [80, 182],
      ].map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={6} fill="none" stroke={AMBER} strokeWidth={2.5} />
      ))}
      <text x={180} y={204} textAnchor="middle" fontSize={12} fontWeight={700} fill={NAVY}>
        1 Front
      </text>
      <text x={290} y={126} fontSize={12} fontWeight={700} fill={NAVY}>
        2 Right
      </text>
      <text x={138} y={52} textAnchor="middle" fontSize={12} fontWeight={700} fill={NAVY}>
        3 Rear
      </text>
      <text x={70} y={126} textAnchor="end" fontSize={12} fontWeight={700} fill={NAVY}>
        4 Left
      </text>
      <text x={180} y={128} textAnchor="middle" fontSize={11} fill={MUTED}>
        seen from above
      </text>
      <line x1={14} y1={226} x2={34} y2={226} stroke={NAVY} strokeWidth={5} strokeLinecap="round" />
      <text x={42} y={230} fontSize={10.5} fill={INK}>
        each side&apos;s two bottom corners, as tapped
      </text>
      <circle cx={24} cy={245} r={5} fill="none" stroke={AMBER} strokeWidth={2.5} />
      <text x={42} y={249} fontSize={10.5} fill={INK}>
        a house corner: where two sides&apos; lines cross
      </text>
    </svg>
  );
}

/**
 * The photo route's capture screen on the lap (Scan 2026-10-15, GuidedExterior.kt): a wall with its two bottom corners tapped,
 * and the card over the chip bar with the next step - which side, the step in big words, the small print - then Photo (lit, a photo
 * is the step) and Add by hand, and Undo · ? · Next side. The words are the app's own.
 */
export function PhotoRouteScreen({ step = "lap" }: { step?: "lap" | "sizes" }) {
  const sizes = step === "sizes";
  return (
    <svg viewBox="0 0 300 600" aria-hidden="true" className="sg-svg sg-phone">
      <defs>
        <linearGradient id="sg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfe0ee" />
          <stop offset="1" stopColor="#eef3f7" />
        </linearGradient>
      </defs>
      <rect x={8} y={8} width={284} height={584} rx={38} fill={NAVY_DARK} />
      <rect x={20} y={30} width={260} height={540} rx={26} fill="url(#sg-sky)" />
      {/* the wall the camera sees: a gable, a window, a door, the ground */}
      <polygon points="40,150 150,92 260,150" fill="#8d7f6c" />
      <polygon points="52,150 248,150 248,286 52,286" fill="#ece6da" stroke="#b9ad9b" strokeWidth={1} />
      <rect x={76} y={176} width={44} height={42} fill="#dfe8f1" stroke="#8d8577" strokeWidth={1.2} />
      <rect x={186} y={214} width={30} height={72} fill="#e8eef4" stroke="#8d8577" strokeWidth={1.2} />
      <rect x={20} y={286} width={260} height={50} fill="#9fb08a" />
      {/* its two bottom corners, tapped */}
      <circle cx={52} cy={286} r={6} fill={GREEN} stroke={PAPER} strokeWidth={2} />
      <circle cx={248} cy={286} r={6} fill={GREEN} stroke={PAPER} strokeWidth={2} />
      {/* Stop, the mini-map */}
      <rect x={32} y={44} width={58} height={30} rx={15} fill="rgba(18,40,63,0.85)" />
      <text x={61} y={64} textAnchor="middle" fontSize={12} fontWeight={600} fill={PAPER}>
        Stop
      </text>
      <rect x={196} y={44} width={70} height={70} rx={8} fill={PAPER} stroke={NAVY} strokeWidth={1} />
      <line x1={210} y1={96} x2={252} y2={96} stroke={NAVY} strokeWidth={2.4} strokeLinecap="round" />
      {/* the ring, green on tracking alone while a corner is the step */}
      {!sizes && <circle cx={150} cy={214} r={20} fill="none" stroke={GREEN} strokeWidth={4.5} />}
      {sizes ? (
        <>
          {/* the card once the lap closes: the sizes, before the photos - a tape, the garage door, or skip */}
          <rect x={30} y={296} width={240} height={180} rx={16} fill="rgba(11,13,16,0.82)" />
          <text x={44} y={314} fontSize={10} fontWeight={700} fill={GREEN}>
            Sizes
          </text>
          {["Tape one wall, or type the", "garage door\u2019s width"].map((t, i) => (
            <text key={t} x={44} y={336 + i * 18} fontSize={14} fontWeight={700} fill={PAPER}>
              {t}
            </text>
          ))}
          {["Either one scales the whole house: the", "corners and every photo read. Easy to", "tape alone: Left 2 (6\u20322\u2033)."].map((t, i) => (
            <text key={t} x={44} y={374 + i * 13} fontSize={9.5} fill="#c9d1d9">
              {t}
            </text>
          ))}
          <Chip x={44} y={412} w={104} label="Tape a wall" lit />
          <Chip x={152} y={412} w={104} label="Garage door width" size={9.5} />
          <Chip x={44} y={444} w={212} label="Skip – no tape" />
        </>
      ) : (
        <>
          {/* the card on the lap: the wall's two corners in, on round the house */}
          <rect x={30} y={318} width={240} height={158} rx={16} fill="rgba(11,13,16,0.82)" />
          <text x={44} y={336} fontSize={10} fontWeight={700} fill={GREEN}>
            Side 1 of the house
          </text>
          {["Next side: walk round", "the corner"].map((t, i) => (
            <text key={t} x={44} y={358 + i * 18} fontSize={14} fontWeight={700} fill={PAPER}>
              {t}
            </text>
          ))}
          {["Then tap its bottom-left corner. No photos", "yet – they come after the lap."].map((t, i) => (
            <text key={t} x={44} y={398 + i * 13} fontSize={9.5} fill="#c9d1d9">
              {t}
            </text>
          ))}
          <Chip x={44} y={434} w={104} label="Next side" lit />
          <Chip x={152} y={434} w={104} label="Photos" />
        </>
      )}
      {/* the chip bar: Photos and Add by hand, then Undo · ? · Next side */}
      <rect x={20} y={482} width={260} height={88} fill="rgba(18,40,63,0.92)" />
      <Chip x={30} y={490} w={116} label="Photos" />
      <Chip x={154} y={490} w={116} label="Add by hand" />
      <Chip x={30} y={528} w={48} label="Undo" />
      <Chip x={135} y={528} w={30} label="?" />
      <Chip x={198} y={528} w={72} label="Next side" />
    </svg>
  );
}

/** An end's pill on Scrivn's roof plan (exteriorDrawings END_INK): a gable in its rakes' colour, a hip in its hips'. */
function EndPill({ x, y, kind }: { x: number; y: number; kind: "gable" | "hip" }) {
  const ink = kind === "hip" ? { stroke: "#6d28d9", fill: "#f5f3ff" } : { stroke: "#b45309", fill: "#fff7ed" };
  const label = kind === "hip" ? "Hip" : "Gable";
  const w = kind === "hip" ? 30 : 42;
  return (
    <g>
      <rect x={x - w / 2} y={y - 10} width={w} height={20} rx={10} fill={ink.fill} stroke={ink.stroke} strokeWidth={1.5} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={ink.stroke}>
        {label}
      </text>
    </g>
  );
}

/**
 * The Roof screen after Finish exterior (RoofReview, roof_overlay): Scrivn's roof plan with Gable or Hip at each end, the
 * lines under it (ExteriorFinish.lines, worded as the engine words them), then Finish · Pitch · Ends and Accept · Close.
 * Finish is greyed, as the app greys it, once every photographed side has been read. The line colours are the roof plan's
 * (exteriorDrawings LINE_STYLE).
 */
export function RoofScreen() {
  const lines = [
    "11.5 SQ · pitch 5/12 (from photos)",
    "Pitch: 5/12, read off the gable photos of Left",
    "Overhangs: eave 1'11\" (from photos) ·",
    "rake 2'2\" (from photos)",
    "Ends: Left gable (photo) · Right hip",
    "Ridge 24'2\" · Hip 40'2\" · Eave 104' · Rake 30'1\"",
    "Left: a gable end, pitch 5/12 (slopes 5.0 …",
    "Front: eave overhang 1'11\"",
    "Assumed: Downspouts: 5, one for each 35' …",
  ];
  return (
    <svg viewBox="0 0 300 600" aria-hidden="true" className="sg-svg sg-phone">
      <rect x={8} y={8} width={284} height={584} rx={38} fill={NAVY_DARK} />
      <rect x={20} y={30} width={260} height={540} rx={26} fill={PAPER} />
      <text x={36} y={70} fontSize={19} fontWeight={700} fill={NAVY}>
        Roof
      </text>
      {/* the roof plan: a gable over Left, a hip over Right */}
      <rect x={80} y={100} width={150} height={110} fill="#f2f5f8" />
      <line x1={80} y1={100} x2={230} y2={100} stroke="#1a1d23" strokeWidth={2} />
      <line x1={80} y1={210} x2={230} y2={210} stroke="#1a1d23" strokeWidth={2} />
      <line x1={230} y1={100} x2={230} y2={210} stroke="#1a1d23" strokeWidth={2} />
      <line x1={80} y1={100} x2={80} y2={210} stroke="#b45309" strokeWidth={2.5} />
      <line x1={80} y1={155} x2={175} y2={155} stroke="#b91c1c" strokeWidth={3} />
      <line x1={175} y1={155} x2={230} y2={100} stroke="#6d28d9" strokeWidth={2.5} />
      <line x1={175} y1={155} x2={230} y2={210} stroke="#6d28d9" strokeWidth={2.5} />
      <EndPill x={52} y={155} kind="gable" />
      <EndPill x={256} y={155} kind="hip" />
      {lines.map((line, i) => (
        <text key={line} x={34} y={262 + i * 17} fontSize={10} fill={INK}>
          {line}
        </text>
      ))}
      <g opacity={0.4}>
        <Btn x={34} y={470} w={70} h={32} label="Finish" />
      </g>
      <Btn x={113} y={470} w={70} h={32} label="Pitch" />
      <Btn x={192} y={470} w={70} h={32} label="Ends" />
      <Btn x={34} y={514} w={110} h={34} label="Accept" />
      <Btn x={156} y={514} w={110} h={34} label="Close" on />
    </svg>
  );
}

/** An air mover as the app draws it (SketchPlan.drawEquipment), simplified: the blower's round housing and its mouth. */
function Mover({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <path d={`M${x + 6},${y - 4} L${x + 15},${y - 7} L${x + 15},${y + 7} L${x + 6},${y + 4} Z`} fill="#ea580c" stroke={PAPER} strokeWidth={1.2} />
      <circle cx={x} cy={y} r={8} fill="#ea580c" stroke={PAPER} strokeWidth={1.5} />
      <path d={`M${x - 3.5},${y} a3.5,3.5 0 1 1 3.5,3.5`} fill="none" stroke={PAPER} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

/** A dehumidifier as the app draws it: a teal box with an upright white drop. */
function Dehu({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 10} y={y - 10} width={20} height={20} rx={3} fill="#0f766e" stroke={PAPER} strokeWidth={1.5} />
      <path d={`M${x},${y - 6} C${x + 4},${y - 1} ${x + 5},${y + 1} ${x + 5},${y + 2} A5,5 0 0 1 ${x - 5},${y + 2} C${x - 5},${y + 1} ${x - 4},${y - 1} ${x},${y - 6} Z`} fill={PAPER} />
    </g>
  );
}

/**
 * A room on Review with its moisture mapped (SketchPlan's colours): a wet line round a corner, tapped at its two ends,
 * the wet floor painted, the equipment the drying plan puts in, and the drying line under the plan.
 */
export function MoistureRoom() {
  return (
    <svg viewBox="0 0 360 250" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={360} height={250} rx={10} fill={PAPER} stroke="#e1e5ea" />
      <rect x={34} y={120} width={118} height={62} fill="#3b82f6" fillOpacity={0.33} />
      <rect x={30} y={24} width={196} height={162} fill="none" stroke={NAVY} strokeWidth={3} />
      <polyline points="30,118 30,186 152,186" fill="none" stroke="#2563eb" strokeWidth={7} />
      <circle cx={30} cy={118} r={5} fill={PAPER} stroke="#2563eb" strokeWidth={2.5} />
      <circle cx={152} cy={186} r={5} fill={PAPER} stroke="#2563eb" strokeWidth={2.5} />
      <text x={128} y={84} textAnchor="middle" fontSize={13} fontWeight={600} fill={MUTED}>
        Laundry
      </text>
      <Mover x={66} y={146} />
      <Mover x={118} y={146} />
      <Dehu x={196} y={52} />
      <line x1={248} y1={40} x2={270} y2={40} stroke="#2563eb" strokeWidth={7} />
      <text x={278} y={44} fontSize={11} fill={INK}>
        wet line
      </text>
      <rect x={248} y={64} width={22} height={14} fill="#3b82f6" fillOpacity={0.33} />
      <text x={278} y={75} fontSize={11} fill={INK}>
        wet floor
      </text>
      <Mover x={256} y={102} />
      <text x={278} y={106} fontSize={11} fill={INK}>
        air mover
      </text>
      <Dehu x={259} y={134} />
      <text x={278} y={138} fontSize={11} fill={INK}>
        dehumidifier
      </text>
      <text x={14} y={214} fontSize={10.5} fill={INK}>
        Drying: 2 air movers · 1 LGR dehumidifier (medium) · Class 2
      </text>
      <text x={14} y={234} fontSize={10.5} fill={MUTED}>
        The wet line&apos;s two taps: the top of the wet line at each end.
      </text>
    </svg>
  );
}

/** The door sheet on Review (MainActivity.askDoor): a door's width tapped. A swing door shows which way it opens. */
export function DoorSheet() {
  return (
    <Dialog w={300} h={318} title={`Door 1 – phone read 2'8"`}>
      <Btn x={30} y={62} w={56} label="Swing" on />
      <Btn x={90} y={62} w={56} label="Bifold" />
      <Btn x={150} y={62} w={56} label="Pocket" />
      <Btn x={210} y={62} w={60} label="Sliding" />
      <Btn x={30} y={100} w={118} label="Single" on />
      <Btn x={152} y={100} w={118} label="Double" />
      <Btn x={30} y={138} w={118} label="Opens in" on />
      <Btn x={152} y={138} w={118} label="Opens out" />
      <Btn x={30} y={176} w={240} label="Hinge on the other side" />
      <text x={32} y={230} fontSize={12} fill={INK}>
        Tape:
      </text>
      <text x={32} y={254} fontSize={11.5} fill={GREY}>
        8&apos;3, 99&quot; or 8.25
      </text>
      <line x1={30} y1={262} x2={270} y2={262} stroke={GREY} strokeWidth={1.5} />
      <text x={262} y={290} textAnchor="end" fontSize={13} fontWeight={600} fill={NAVY}>
        DONE
      </text>
    </Dialog>
  );
}

/** The 360 step (MainActivity.askSpinPlace): Review asks where you stand; a tap on the plan begins the 360 there. */
export function SpinPlace() {
  return (
    <svg viewBox="0 0 300 330" aria-hidden="true" className="sg-svg">
      <rect x={0} y={0} width={300} height={330} rx={12} fill={PAPER} stroke="#e1e5ea" />
      <text x={20} y={38} fontSize={16} fontWeight={700} fill={NAVY}>
        Tap where you&apos;re standing
      </text>
      <polygon points="40,66 260,66 260,186 170,186 170,236 40,236" fill="#f2f5f8" stroke={NAVY} strokeWidth={3} />
      <circle cx={130} cy={130} r={14} fill="none" stroke={GREEN} strokeWidth={3} />
      <circle cx={130} cy={130} r={5} fill={GREEN} />
      <text x={130} y={160} textAnchor="middle" fontSize={10.5} fill={INK}>
        where you stand
      </text>
      {["360s · tap where you are standing, then turn", "as the dots ask. Done when you have them all."].map((line, i) => (
        <text key={line} x={20} y={260 + i * 15} fontSize={11} fill={INK}>
          {line}
        </text>
      ))}
      <Btn x={180} y={288} w={100} h={28} label="Done" on />
    </svg>
  );
}

/** The Account sheet, signed out (AccountScreen.signedOut). */
export function AccountSheet() {
  return (
    <Dialog w={300} h={240} title="Scrivn account: not signed in">
      {["Sign in", "Create an account", "Pair with a code from Scrivn", "Delete an account"].map((row, i) => (
        <text key={row} x={32} y={84 + i * 34} fontSize={13} fill={INK}>
          {row}
        </text>
      ))}
      <text x={262} y={212} textAnchor="end" fontSize={13} fontWeight={600} fill={NAVY}>
        CLOSE
      </text>
    </Dialog>
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
