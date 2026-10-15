import QRCode from "qrcode";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { appUrl } from "@/lib/deviceCodes";
import {
  AccountSheet,
  CaptureScreen,
  ClosetStep,
  DoorSheet,
  DropAsk,
  ExteriorRound,
  ExteriorSide,
  HowtoArt,
  JoinRooms,
  MoistureRoom,
  ReportDialog,
  ReviewScreen,
  Ring,
  SpinDots,
  SpinPlace,
} from "@/components/scanGuide/Figures";
import type { HowtoName } from "@/components/scanGuide/howtoDrawings";
import "./scan-guide.css";

/**
 * The tester guide for Scrivn Scan (2026-10-07): how to use it, tips from the walks so far, and how
 * to send us a scan that went wrong. Public and static - a tester reads it on the phone they scan
 * with, with no Scrivn account - and written for Scan as a product of its own: Scrivn comes in near
 * the end.
 *
 * Every button and line quoted here is the app's own word (res/values/strings.xml, Copy.kt,
 * Instructions.kt, and for the outside of the house Exterior.kt and MainActivity's exterior lines);
 * when the app's wording changes, this page changes with it. The drawings in public/scan-guide are
 * the app's how-to pictures (scripts/howto-svgs.py); the screens are drawn in
 * components/scanGuide/Figures.tsx.
 *
 * Brought up to Scan 0.1.157 on 2026-10-14: the two chip rows, levels, moisture as you go, door
 * types, the 360 step at the end, the Exterior sketch, the Account screen and free scans, and what
 * happens with no signal. What Scrivn does with a scan is told in Scrivn's own Help.
 */
export const metadata = {
  title: "Scrivn Scan — Tester Guide",
  description:
    "How to measure rooms and the outside of a house with Scrivn Scan, map moisture as you go, tips that make the numbers right, and how to send us a scan that went wrong.",
};

const SECTIONS = [
  ["start", "Before you start"],
  ["screen", "The capture screen"],
  ["ring", "The ring"],
  ["room", "Measure a room"],
  ["openings", "Doors, windows and openings"],
  ["fixtures", "Cabinets, tubs and appliances"],
  ["more", "Stairs, ceilings and the awkward bits"],
  ["rooms", "More than one room"],
  ["levels", "More than one floor"],
  ["moisture", "Moisture as you go"],
  ["drops", "When tracking drops"],
  ["review", "Review: check it, tape it"],
  ["spins", "360° photos"],
  ["exterior", "The outside of the house"],
  ["account", "Your account and free scans"],
  ["scrivn", "Sending to Scrivn (optional)"],
  ["signal", "No signal"],
  ["tips", "Tips that make the numbers right"],
  ["report", "Send us a scan that went wrong"],
  ["known", "Rough edges we know about"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/** A section's number, from its place in SECTIONS, so a new section never leaves a stale "see section 9". */
function num(id: SectionId): number {
  return SECTIONS.findIndex(([s]) => s === id) + 1;
}

/** A link to another section by its title. */
function See({ id }: { id: SectionId }) {
  const title = SECTIONS.find(([s]) => s === id)?.[1] ?? "";
  return <a href={`#${id}`}>{title}</a>;
}

function B({ children }: { children: React.ReactNode }) {
  // A button or chip in the app, by its label.
  return <span className="sg-btn">{children}</span>;
}

function Q({ children }: { children: React.ReactNode }) {
  // A line the app shows, quoted.
  return <span className="sg-quote">{children}</span>;
}

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="sg-section">
      <h2>
        <span className="sg-num" aria-hidden="true">
          {num(id)}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Drawing({ name, caption }: { name: HowtoName; caption: string }) {
  return (
    <figure className="sg-fig sg-drawing">
      <div className="sg-drawing-art">
        <HowtoArt name={name} />
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default async function ScanGuidePage() {
  // The download, as a QR for a tester reading this on a computer: the phone's camera opens it.
  const download = `${appUrl()}/scan-download`;
  const qr = await QRCode.toString(download, { type: "svg", margin: 1, color: { dark: "#1b3a5c", light: "#ffffff" } });
  return (
    <MarketingShell page="scan-guide">
      <div className="sg">
        <header className="sg-hero wrap-narrow">
          <p className="sg-kicker">Scrivn Scan · tester guide</p>
          <h1>Measure a room by tapping its corners</h1>
          <p>
            Scrivn Scan turns your Android phone into a measuring tool. Stand in the middle of a room, tap each corner, and it draws
            the floor plan with every wall, door, window and cabinet on it. It maps wet walls and floors as you go, and it measures
            the outside of the house side by side. Thank you for testing it. This page shows how it works, what gets the best numbers,
            and how to send us a scan that came out wrong. That last part is what helps us most.
          </p>
        </header>

        <div className="wrap-narrow">
          <div className="sg-quick">
            <h2>The short version</h2>
            <ol>
              <li>
                Install the test version from <a href="/scan-download">scrivn.ca/scan-download</a> (<See id="start" />).
              </li>
              <li>
                Turn the room&apos;s lights on. Press <B>Start</B>, then hold the phone up and walk a few steps until the ring turns green.
              </li>
              <li>Stand near the middle of the room. Aim the ring at each corner, 6 to 8 ft away, and tap the screen. Go round the room.</li>
              <li>
                Tap corner 1 again to close the room. Then tap each door, window and opening at its two sides. Wet walls? <B>Wet line</B>{" "}
                is on the first row now.
              </li>
              <li>
                Open the plan (the little map, top right). <strong>Tape at least one wall in every room</strong>, the longest, then tap
                its length and type what your tape says. <B>Share</B> sends the plan as a PDF and a JPG, to scale.
              </li>
              <li>
                Next room: <B>Add room</B>, tap its corners, tap the doorway you came through, then <B>More…</B> → <B>Join this room to another</B>.
                Another floor: hold <B>Add room</B>.
              </li>
              <li>
                Outside: <B>Start</B> → <B>Exterior sketch</B>, then each side in turn (<See id="exterior" />).
              </li>
              <li>
                Anything wrong? On the plan, tap <B>Report a problem</B> and tell us. Did the room twice? Report after the second run;
                both come along.
              </li>
            </ol>
          </div>

          <nav className="sg-toc" aria-label="On this page">
            <ol>
              {SECTIONS.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <Section id="start" title="Before you start">
            <div className="sg-install">
              <div className="sg-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
              <div>
                <h3 className="sg-h3">Installing the test version</h3>
                <p className="sg-small">Scan isn&apos;t on Google Play yet, so testers install it from our site.</p>
                <ol className="sg-steps">
                  <li>
                    On your phone, open <a href="/scan-download">scrivn.ca/scan-download</a>, or point the phone&apos;s camera at this code.
                    It downloads the newest test version.
                  </li>
                  <li>
                    Open the downloaded file. Android asks whether your browser may install apps: allow it, go back, and tap{" "}
                    <strong>Install</strong>.
                  </li>
                  <li>
                    If Google Play Protect says it doesn&apos;t recognise the app or its developer, tap <strong>More details</strong>, then{" "}
                    <strong>Install anyway</strong>. That&apos;s because it isn&apos;t from the Play Store yet.
                  </li>
                  <li>To update, open the same link and install over the top. Nothing you&apos;ve set is lost.</li>
                </ol>
                <p className="sg-small">When Scan is on Google Play you may need to uninstall this test copy before installing that one.</p>
              </div>
            </div>
            <ul className="sg-list">
              <li>
                <strong>Your phone.</strong> An Android phone that runs Google&apos;s ARCore with its depth camera feature. Most recent Samsung
                Galaxy S and Google Pixel phones do. We test on a Galaxy S25 Ultra. If yours can&apos;t, the app says{" "}
                <Q>This phone does not support the ARCore Depth API</Q>. Please tell us which phone it was. There is no iPhone version yet:
                Android comes first.
              </li>
              <li>
                <strong>First open.</strong> Allow the camera (it is how Scan measures) and let Android install or update{" "}
                <em>Google Play Services for AR</em> if it asks.
              </li>
              <li>
                <strong>No account needed.</strong> Scan works on its own: the plan is on the Review screen, and <B>Share</B> sends it as a
                PDF and a JPG. Signing in to a Scrivn account, to send rooms into a claim, is optional (<See id="account" />).
              </li>
              <li>
                <strong>No signal needed to measure.</strong> Everything you tap stays on the phone. Only sending, signing in and reporting
                need a connection (<See id="signal" />).
              </li>
              <li>
                <strong>Lights on, phone charged.</strong> Dim rooms measure short (more on that in the tips), and the camera works hard. If
                the phone gets too warm it says <Q>Phone is hot — let it cool before scanning</Q>.
              </li>
              <li>
                <strong>Help in the app.</strong> The <B>?</B> chip explains whichever chip is lit. <B>More…</B> → <B>How to use this app</B>{" "}
                has every step with a drawing, and <B>Walk me through a room</B> guides you through your first room.
              </li>
            </ul>
          </Section>

          <Section id="screen" title="The capture screen">
            <div className="sg-split">
              <figure className="sg-fig sg-phonefig">
                <CaptureScreen />
                <figcaption>The capture screen, drawn. The numbers match the list.</figcaption>
              </figure>
              <ol className="sg-legend">
                <li>
                  <B>Stop</B> finishes the capture. After it the bottom row reads <B>Start</B> · <B>Share</B> · <B>Send</B>. A long press
                  on Share saves the capture&apos;s files for us; you won&apos;t need it. When you&apos;re not capturing, <B>Account</B> sits
                  in Stop&apos;s place.
                </li>
                <li>
                  <strong>The mini-map.</strong> Your plan so far, with you on it. Tap it (or swipe up) to open <strong>Review</strong>, the
                  full plan.
                </li>
                <li>
                  <strong>The ring.</strong> What you aim with. A tap anywhere on the camera picture measures whatever is in the ring. Its
                  colour says whether a tap will read (next section).
                </li>
                <li>
                  <strong>The line.</strong> One line that says what just happened and what to do next, for example{" "}
                  <Q>Corner 2 · wall 1: 12&apos;6&quot;</Q>. When in doubt, read the line.
                </li>
                <li>
                  <strong>The chips.</strong> What your next tap is. The first row: <B>Corner</B>, <B>Door</B>, <B>Opening</B>,{" "}
                  <B>Window</B>, <B>Closet</B> (a closet door), and <B>Wet line</B> once the room is closed. The second row:{" "}
                  <B>Cabinet ▾</B>, <B>Fixture ▾</B>, <B>Ceiling</B>, <B>Stairs</B> and <B>More…</B> for the rest. The lit chip is green.
                </li>
                <li>
                  <B>Undo</B> takes back the last tap, so use it freely. <B>?</B> explains the lit chip. <B>Add room</B> starts the next
                  room in the same capture; hold it for another floor. Once a room is closed, <B>Moisture</B> joins this row, and on a
                  walk-through capture <B>360°</B> too.
                </li>
              </ol>
            </div>
          </Section>

          <Section id="ring" title="The ring">
            <p>The ring is the one thing to watch. Its colour tells you whether a tap will read:</p>
            <ul className="sg-rings">
              <li>
                <Ring colour="green" />
                <div>
                  <strong>Green: tap.</strong> The phone knows where it is and can see what&apos;s in the ring. A tap that reads gives a
                  small buzz.
                </div>
              </li>
              <li>
                <Ring colour="amber" hint="sway" />
                <div>
                  <strong>Amber, &ldquo;sway&rdquo;.</strong> The depth camera needs you to move. Take a step sideways, then tap. Amber with{" "}
                  <Q>hold on…</Q> means the map is checking itself; give it a second.
                </div>
              </li>
              <li>
                <Ring colour="red" hint="tracking…" />
                <div>
                  <strong>Red, &ldquo;tracking…&rdquo;.</strong> The phone has lost the room. Taps are ignored until it finds it again (
                  <See id="drops" />
                  ).
                </div>
              </li>
              <li>
                <Ring colour="grey" />
                <div>
                  <strong>Grey.</strong> Before <B>Start</B> and after <B>Stop</B>. Nothing is measured.
                </div>
              </li>
            </ul>
          </Section>

          <Section id="room" title="Measure a room">
            <div className="sg-split">
              <div>
                <ol className="sg-steps">
                  <li>
                    Press <B>Start</B>. It asks what you are capturing: <B>Sketch only</B>, <B>Sketch + walk-through</B> if you also want
                    360° photos of the rooms, or <B>Exterior sketch</B> for the outside of the house (<See id="exterior" />).
                  </li>
                  <li>
                    Hold the phone up and walk a few steps around the room, not on the spot, until the ring turns green. When you start a
                    new room the line says <Q>Room 2 · look round it slowly first</Q>. Do that too.
                  </li>
                  <li>
                    <strong>Stand near the middle and stay there.</strong> You don&apos;t walk to the corners; you tap them from where you
                    stand. 6 to 8 ft away reads best. If you&apos;re too close, the line says <Q>Step back — corners read best from 6–8 ft</Q>.
                  </li>
                  <li>
                    Aim the ring at the corner, where the two walls meet, at about chest height, and tap. Then the next corner, going round
                    the room one way. The line gives each wall as it goes: <Q>Corner 2 · wall 1: 12&apos;6&quot;</Q>.
                  </li>
                  <li>
                    Back at the first corner, tap it again. That closes the room:{" "}
                    <Q>Room closed · W × D · N corners — openings or wet lines next, or Add room</Q>. The chip moves to <B>Door</B> for you.
                  </li>
                </ol>
                <p className="sg-note">
                  <strong>A closet or small room against walls you&apos;ve already tapped?</strong> Just tap its own corners. Once they close it
                  off, Scan takes the rest from the walls already there.
                </p>
              </div>
              <div className="sg-figs">
                <Drawing name="start" caption="Walk a few steps with the phone up until the ring is green." />
                <Drawing name="corner" caption="Stand in the middle, tap every corner from there, then corner 1 again." />
              </div>
            </div>
          </Section>

          <Section id="openings" title="Doors, windows and openings">
            <div className="sg-split">
              <div>
                <ul className="sg-list">
                  <li>
                    <B>Door</B>, <B>Opening</B> (a doorway with no door) and <B>Closet</B> (a closet door) are two taps:{" "}
                    <strong>its left jamb, then its right jamb</strong>. Keep the ring on the frame, not the gap. Aim a hand-width onto
                    the wall beside it. The line confirms the width: <Q>Door 1 · 2&apos;8&quot;</Q>.
                  </li>
                  <li>
                    <B>Window</B> is two taps on the outside of the casing: <strong>the bottom of its left edge, then the top of its right
                    edge</strong>. Those two taps give the width, the sill and the head.
                  </li>
                  <li>The chip stays lit after an opening, so you can go straight on to the next one.</li>
                  <li>
                    <strong>What kind of door:</strong> swing, bifold, pocket or sliding, and which way it opens, is set on Review by
                    tapping the door&apos;s width (<See id="review" />).
                  </li>
                  <li>
                    <strong>Closets:</strong> tap a closet&apos;s door with <B>Closet</B>, not <B>Door</B>. Before Send or Share, Scan asks
                    about each closet door (<See id="review" />).
                  </li>
                </ul>
              </div>
              <div className="sg-figs">
                <Drawing name="opening" caption="An opening is its two jambs." />
              </div>
            </div>
          </Section>

          <Section id="fixtures" title="Cabinets, tubs and appliances">
            <div className="sg-split">
              <div>
                <ul className="sg-list">
                  <li>
                    Press <B>Cabinet ▾</B> and pick <B>Base (lower)</B>, <B>Upper</B> or <B>Full height</B>. Each run is two taps, one at
                    each end. Aim at the <strong>wall above it</strong> or at the <strong>face of the cabinet</strong>, whichever you can
                    see.
                  </li>
                  <li>
                    At an inside corner, tap each run as far as you can see it and stop. The corner cabinet fills itself in. A gap wider
                    than a cabinet is read as an appliance (a fridge, a dishwasher) and left alone.
                  </li>
                  <li>
                    A run out in the floor is an <strong>island</strong>. It asks for a third tap on its back edge, which gives its depth.
                  </li>
                  <li>
                    <B>Fixture ▾</B> has <B>Tub</B>, <B>Shower</B>, <B>Fridge / freezer</B> and <B>Range</B>, each tapped the same way:
                    at its two ends. A tub that nearly fills its alcove is stretched to fit it.
                  </li>
                </ul>
              </div>
              <div className="sg-figs">
                <Drawing name="cabinet" caption="A run on the wall is two taps; an island is two, then its back edge." />
              </div>
            </div>
          </Section>

          <Section id="more" title="Stairs, ceilings and the awkward bits">
            <p>
              <B>Stairs</B> and <B>Ceiling</B> are on the second row; the rest are on <B>More…</B>. Each has its own drawing in the app
              (tap <B>?</B> once it is lit).
            </p>
            <div className="sg-cards">
              <div className="sg-card">
                <HowtoArt name="stairs" />
                <h3>Stairs</h3>
                <p>
                  Four taps round the flight like a rectangle: both ends of the near riser, then the far riser, starting on the same side.
                  The line at the end says which way it read the flight. Check it before moving on.
                </p>
              </div>
              <div className="sg-card">
                <HowtoArt name="ceiling" />
                <h3>Ceiling</h3>
                <p>
                  Aim at the ceiling and tap, then tap once more to check it. A flat ceiling: the second tap on the same spot - the two
                  reads should agree. For a slope or a vault, tap the high side, then where the ceiling meets the wall at its low side. You
                  can also set it on Review.
                </p>
              </div>
              <div className="sg-card">
                <HowtoArt name="cant_reach" />
                <h3>Can&apos;t reach</h3>
                <p>
                  For a corner you can&apos;t see. Tap the wall leading into it twice, at least 3 ft apart, then the wall leading out of it
                  twice. The corner is worked out where the two walls cross.
                </p>
              </div>
              <div className="sg-card">
                <HowtoArt name="open_span" />
                <h3>Open span</h3>
                <p>
                  Where the floor stops and there is no wall, like the top of a stair between half walls. Two taps, one at each end, in
                  place of two corners.
                </p>
              </div>
              <div className="sg-card">
                <HowtoArt name="wall_end" />
                <h3>Wall end</h3>
                <p>
                  The free end of a thin partition: one tap on its end. It&apos;s the hardest tap in the app. If it won&apos;t come in
                  straight after a try or two, leave it out.
                </p>
              </div>
              <div className="sg-card">
                <HowtoArt name="corner_unit" />
                <h3>Corner unit</h3>
                <p>
                  A fireplace or pantry built across a corner with short returns: four taps (wall, front, front, wall). A plain angled
                  corner needs nothing special: just two corner taps.
                </p>
              </div>
            </div>
            <p className="sg-note">
              <strong>Finish this room</strong> (on <B>More…</B>) closes a room where you stand. Use it when the last wall is one you
              can&apos;t tap, or when a closet&apos;s other walls are already there.
            </p>
          </Section>

          <Section id="rooms" title="More than one room">
            <div className="sg-split">
              <div>
                <ol className="sg-steps">
                  <li>
                    In the room you&apos;re finishing, tap the doorway into the next room (<B>Door</B> or <B>Opening</B>, both jambs).
                  </li>
                  <li>
                    Walk through with the phone up and press <B>Add room</B>. Its text turns green when the room you&apos;re in is closed.
                    Look round the new room slowly first, then tap its corners from its middle.
                  </li>
                  <li>
                    Tap the same doorway from this side, both jambs. Then <B>More…</B> → <B>Join this room to another</B>. The plan zooms
                    to the two doorways, marked <em>here</em> and <em>there</em>; press <B>Join here</B>. If it picked the wrong pair,{" "}
                    <B>Another doorway</B> shows the next one.
                  </li>
                </ol>
                <p>
                  <strong>Join every room at its doorway.</strong> Joining lays the room exactly against its neighbour. It&apos;s also what
                  puts a room back in place after tracking drops. <B>Undo</B> right after a join takes it back.
                </p>
                <p className="sg-note">
                  Forgot a doorway in the room you left? Open Review and <strong>hold your finger on that wall</strong>: it offers{" "}
                  <B>Door</B>, <B>Opening</B> or <B>Closet door</B> there, and the join comes up with it. To go back and add to an earlier
                  room, tap its name on Review (during a capture).
                </p>
              </div>
              <figure className="sg-fig">
                <JoinRooms />
                <figcaption>Each room taps its own side of the doorway they share; the join lays them together there.</figcaption>
              </figure>
            </div>
          </Section>

          <Section id="levels" title="More than one floor">
            <p>
              A basement, a main floor and an upstairs go in one capture, a level each. <strong>Hold your finger on Add room</strong>:
            </p>
            <ul className="sg-list">
              <li>
                <B>New level above</B> or <B>New level below</B> starts a level. It asks for a name (<Q>e.g. Second floor</Q>,{" "}
                <Q>e.g. Basement</Q>) and, the first time, the name of the level you are on now (<Q>e.g. Main floor</Q>). Press{" "}
                <B>Start it</B>, go to that floor, and tap its first room as you would any room.
              </li>
              <li>
                Each level is a plan of its own: its rooms are tapped fresh and joined to each other, not to the floor above or below. You
                don&apos;t need to line the floors up at the stairs.
              </li>
              <li>
                <B>Back to</B> a level returns to it; <B>Rename</B> changes a level&apos;s name. Review shows the rooms of the level you
                are on.
              </li>
              <li>
                <B>Share</B> makes a plan page for each level. <B>Send</B> sends each level into the claim as its own storey: it asks{" "}
                <Q>Which storey is Main floor?</Q> for the level you started on, and places the others above or below it.
              </li>
            </ul>
          </Section>

          <Section id="moisture" title="Moisture as you go">
            <div className="sg-split">
              <div>
                <p>
                  Optional, for water jobs: the wet walls, floor and ceiling of each room, marked while you stand in it. Scrivn turns them
                  into the claim&apos;s moisture map.
                </p>
                <h3 className="sg-h3">Wet walls: Wet line</h3>
                <ol className="sg-steps">
                  <li>
                    Once a room is closed, <B>Wet line</B> appears at the end of the first row. Press it:{" "}
                    <Q>Wet line · tap the top of the wet line at one end of a wet stretch</Q>.
                  </li>
                  <li>
                    Aim the ring at the <strong>top of the wet line</strong>, as high as the meter finds it wet, at one end of the wet
                    stretch, and tap. Then the same at its other end. Round a corner, tap one end on each wall.
                  </li>
                  <li>
                    Scan lays it on that wall, in whichever room it is, and reads how high it is wet. A box asks what the wall is (
                    <B>Drywall</B>, <B>Wood framing</B>, <B>Paneling</B> or <B>Concrete</B>), the <B>Meter reading (optional)</B>, and the
                    height, which you can type over. <B>Undo last</B> there takes the line back.
                  </li>
                  <li>The chip stays lit for the next wet line.</li>
                </ol>
                <h3 className="sg-h3">Floors, ceilings and the job: Moisture</h3>
                <p>
                  <B>Moisture</B> on the bottom row swaps the chips for <B>Wet line</B>, <B>Floor</B>, <B>Ceiling</B>, <B>Setup</B> and{" "}
                  <B>Done</B>.
                </p>
                <ul className="sg-list">
                  <li>
                    <B>Floor</B> and <B>Ceiling</B> open the plan to paint the current room:{" "}
                    <Q>Paint the wet floor of Laundry with a finger - two fingers move the plan</Q>. Drag a finger where it is wet.{" "}
                    <B>Whole room</B> fills it (then <B>Clear room</B> empties it), <B>Erase</B> then a drag takes paint off,{" "}
                    <B>Undo last</B> takes back the last stroke, and <B>Done</B> goes back to the camera.
                  </li>
                  <li>
                    <B>Setup</B> takes the <strong>dry reference</strong> (a reading of the same material where it did not get wet, one
                    per material), the <strong>water class</strong>, which <strong>dehumidifiers</strong> you use (LGR or desiccant, and
                    their size), and the room&apos;s wall insets over 18&quot;.
                  </li>
                  <li>
                    <B>Done</B> goes back to the room chips. You can come back to Moisture whenever a room is closed.
                  </li>
                </ul>
                <p>
                  Review then draws the air movers and dehumidifiers the drying plan calls for, and says what they come to:{" "}
                  <Q>Drying: 2 air movers · 1 LGR dehumidifier (medium) · Class 2</Q>. It is the same drying calculation Scrivn uses.
                  Send carries the wet lines, readings, painted areas and setup into the claim.
                </p>
              </div>
              <div className="sg-figs">
                <figure className="sg-fig">
                  <MoistureRoom />
                  <figcaption>A room on Review: a wet line round a corner, the wet floor painted, and the equipment it calls for.</figcaption>
                </figure>
                <Drawing name="wet" caption="The app's own drawing: tap the top of the wet line at each end of the stretch." />
              </div>
            </div>
          </Section>

          <Section id="drops" title="When tracking drops">
            <div className="sg-split">
              <div>
                <p>
                  The phone keeps track of where it is by what it sees. Bare walls, dark stairwells, doorways and fast turns can make it lose
                  the room: the ring turns red and the line says <Q>Finding the room again — hold the phone up</Q>.
                </p>
                <ul className="sg-list">
                  <li>
                    <strong>Stop walking.</strong> Hold the phone up and turn slowly, looking at the parts of the room you&apos;ve already
                    tapped: corners, furniture, doorways. Not the ceiling, not a bare wall.
                  </li>
                  <li>
                    When it&apos;s back it may ask for one corner again: <Q>Tap corner 3 again — ringed in orange on the map</Q>. Aim at that
                    corner and tap it. That ties the map back together: <Q>Back on the map — carry on</Q>.
                  </li>
                  <li>
                    Lengths it isn&apos;t sure of yet read <Q>checking…</Q> on the plan until a tap or a join settles them.
                  </li>
                  <li>
                    Still off? <B>More…</B> → <B>Re-find me on the map</B> asks for two or three corners you tapped before and moves the
                    sketch to match.
                  </li>
                  <li>
                    If one spot keeps dropping, it has nothing to track. Work from where you can see more of the room. If a room is
                    hopeless, finish what you can, <B>Add room</B>, and do the rest as a second room. Two rooms you can trust beat one you
                    can&apos;t.
                  </li>
                </ul>
              </div>
              <div className="sg-figs">
                <figure className="sg-fig">
                  <DropAsk />
                  <figcaption>After a drop: the corner to tap again is ringed in orange.</figcaption>
                </figure>
                <Drawing name="lost" caption="Stop, turn slowly, show it what it has seen before." />
              </div>
            </div>
          </Section>

          <Section id="review" title="Review: check it, tape it">
            <div className="sg-split">
              <figure className="sg-fig sg-phonefig">
                <ReviewScreen />
                <figcaption>Review: a typed length shows the phone&apos;s reading struck through.</figcaption>
              </figure>
              <div>
                <p>Tap the mini-map to open Review, during a capture or after Stop. It&apos;s the whole plan, drawn to scale.</p>
                <ul className="sg-list">
                  <li>
                    <strong>Best practice: tape at least one wall in every room.</strong> The longest one is best. It checks the
                    phone&apos;s reading against a real measurement and sets the plan&apos;s scale. Two walls in a dim room. Until a room
                    has one, the line under the plan reminds you:{" "}
                    <Q>Tape one wall for true sizes — tap its longest wall&apos;s length, type your tape, tick Scale the whole room</Q>.
                  </li>
                  <li>
                    <strong>Every length is a button.</strong> Tap it and type what your tape says (<Q>8&apos;3</Q>, <Q>99&quot;</Q> or{" "}
                    <Q>8.25</Q>). The room resizes around it. The phone&apos;s reading stays visible, struck through. <B>Reset tape</B>{" "}
                    takes typed lengths off again.
                  </li>
                  <li>
                    <strong>Scale the whole room to this wall.</strong> Tick it when you type a tape length and every wall in the room
                    scales by the same amount. It suits a room that reads short all round (see the tips).
                  </li>
                  <li>
                    <strong>Tap a door&apos;s width to say what kind of door it is</strong>: <B>Swing</B>, <B>Bifold</B>, <B>Pocket</B> or{" "}
                    <B>Sliding</B>, <B>Single</B> or <B>Double</B>, and for a swing door <B>Opens in</B> or <B>Opens out</B> and{" "}
                    <B>Hinge on the other side</B>. The tape for its width is in the same box. A door left alone goes over as a swing
                    door, a closet door as a bifold, and anything 3&apos;6&quot; or wider as a pair. Setting it in one room sets the same
                    doorway in the room next door.
                  </li>
                  <li>
                    <strong>Name the room and set its ceiling</strong> with the two buttons under the plan. Flat, sloped or vaulted.
                  </li>
                  <li>
                    <strong>Hold a wall</strong> to put a door, opening or closet door on it.
                  </li>
                  <li>
                    <strong>Pinch</strong> to zoom, drag to move, double-tap to fit it back. <B>Undo last</B> takes back the last thing
                    you did.
                  </li>
                  <li>
                    <B>Share</B> (here, or on the bottom row after Stop) makes a PDF and a JPG of the plan, to scale, walls drawn 4&quot;
                    thick: the whole plan with every wall&apos;s length and a 10 ft scale bar, then each room&apos;s size, floor area,
                    perimeter, ceiling and wall area, doors, windows and cabinets. It asks about closets first, as Send does. Add a job
                    name or address if you like. Both are saved to <em>Download/Scrivn Scan</em> and the share sheet opens, so you can
                    email them, print them or put them in Drive. No account needed. The PDF prints to scale at 100% (not fit to page);
                    the JPG can be an underlay in Xactimate, set to scale off its 10 ft bar or any wall you taped.
                  </li>
                </ul>
                <figure className="sg-fig">
                  <DoorSheet />
                  <figcaption>A door&apos;s width tapped on Review: what kind of door, which way it opens, and its tape.</figcaption>
                </figure>
                <h3 className="sg-h3">The closets step</h3>
                <p>
                  When you press Send or Share, Review shows each closet door in turn with a dashed <strong>Closet?</strong> box behind
                  it. Tap the box if there&apos;s a closet there and it&apos;s drawn in; leave it if not. <B>Next closet</B> moves on and
                  the last one reads <B>Send</B> (or <B>Share</B>). A closet bigger than the box? <B>Back</B>, then tap it as a room of its own and join it
                  at its door.
                </p>
                <figure className="sg-fig">
                  <ClosetStep />
                  <figcaption>The closets step: tap the dashed box to draw the closet in.</figcaption>
                </figure>
              </div>
            </div>
          </Section>

          <Section id="spins" title="360° photos">
            <div className="sg-split">
              <div>
                <p>
                  Start with <B>Sketch + walk-through</B> to take 360° photos. They are a step of their own at the end, after the
                  sketch and the moisture: the camera stops tracking the rooms while you take them, so do your tapping first.
                </p>
                <ol className="sg-steps">
                  <li>
                    Once a room is closed, <B>360°</B> is on the bottom row. Press it. Review opens, titled{" "}
                    <Q>Tap where you&apos;re standing</Q>.
                  </li>
                  <li>
                    Stand where you want the 360 and tap that spot on the plan. The wide camera takes over the screen; hold still while it
                    sets up (<Q>360° – hold still a moment</Q>).
                  </li>
                  <li>
                    Hold the phone at chest height and turn slowly on the spot. Hold the ring on the amber dot until its arc fills and it
                    turns into a green tick. Then the next dot. There are 12 round the room at eye level, then 6 on the floor: tilt down
                    when the line says so.
                  </li>
                  <li>
                    After each 360 the plan comes back: walk to the next spot and tap where you are standing. Press <B>Done</B> when you
                    have them all: <Q>360s done - 3 taken. Keep tapping, or Stop.</Q>
                  </li>
                </ol>
                <p className="sg-note">
                  The first time, a card explains the step. If the phone lost its bearing (the app was left and came back), the line says{" "}
                  <Q>The phone lost its bearing - walk a few steps, then 360 again</Q>.
                </p>
              </div>
              <div className="sg-figs">
                <figure className="sg-fig">
                  <SpinPlace />
                  <figcaption>The 360 step: tap the plan where you stand.</figcaption>
                </figure>
                <figure className="sg-fig">
                  <SpinDots />
                  <figcaption>Then turn on the spot; hold the ring on each amber dot until it fills.</figcaption>
                </figure>
              </div>
            </div>
          </Section>

          <Section id="exterior" title="The outside of the house">
            <p>
              <B>Exterior sketch</B> measures the outside walls one side at a time: each side&apos;s length and heights, the cladding on
              it (stucco, vinyl, brick and the rest) with its area, and its windows and doors. It draws the <strong>siding elevations
              only</strong>: you don&apos;t tap the roof. Use it for siding and stucco work, or when Scrivn needs the house&apos;s
              footprint to work out a roof. It is a capture of its own: the rooms inside are a separate capture.
            </p>
            <div className="sg-split">
              <div>
                <h3 className="sg-h3">Each side</h3>
                <ol className="sg-steps">
                  <li>
                    Press <B>Start</B> → <B>Exterior sketch</B>. It asks <Q>What are you tapping?</Q>: pick the main cladding (
                    <B>Stucco</B>, <B>Vinyl</B>, <B>Wood shake</B>, <B>EIFS</B>, <B>Wood</B>, <B>Fibre cement</B>, <B>Brick</B>,{" "}
                    <B>Stone</B>, <B>Metal</B>) or <B>Parging</B>. The chips are now that material, <B>Window</B>, <B>Door</B> and{" "}
                    <B>Photo</B>, and <B>Next side</B> takes Add room&apos;s place.
                  </li>
                  <li>
                    Start at the front. Stand <strong>1 to 3 m (3 to 10 ft) from the wall</strong> and tap a{" "}
                    <strong>bottom corner of the siding or stucco: at the top of the parging, not the ground</strong>. Then along the
                    bottom to its next corner: the other end, or where the bottom steps. Those two fix the wall, so they are read by the
                    depth camera and need you that close: <Q>Front: wall fixed, 34&apos;3&quot; between them.</Q>
                  </li>
                  <li>
                    Step back until you can see the whole side. Aim at each corner of the material in turn: along the bottom where it
                    steps, up the end, over the top (the eave, or a gable&apos;s peak), down the other end, and{" "}
                    <strong>back to the first corner to close it</strong>: <Q>Stucco closed: 412 SF. Windows and doors, another material, or Next side.</Q>{" "}
                    These taps are aimed at the wall the first two fixed, so the ring is green as soon as tracking is good.
                  </li>
                  <li>
                    <strong>Another material:</strong> press the material chip again and pick it, the parging say, then tap round it the
                    same way, down to the ground. A corner within about 6&quot; of one already tapped lands on it (
                    <Q>on the corner already there</Q>), so the stucco&apos;s bottom and the parging&apos;s top are one line. Tap the main
                    cladding first and an accent (a stone wainscot) after: where two shapes overlap, the one tapped later counts there.
                  </li>
                  <li>
                    <B>Window</B>: two opposite corners of its <strong>opening in the siding or stucco, not the frame or the glass</strong>:
                    bottom-left, then top-right. <Q>Window 1: 3&apos;0&quot; × 4&apos;6&quot;, sill 3&apos;2&quot;.</Q>
                  </li>
                  <li>
                    <B>Door</B>: a bottom corner of its opening at the threshold, then the opposite top corner. Tap a garage door the same
                    way; a door 7&frac12; ft wide or more goes to Scrivn as a garage door.
                  </li>
                  <li>
                    <strong>A bottom that steps</strong> (the grade falls away, a walk-out): tap along the bottom as it runs, corner by
                    corner. The first two fix the wall but needn&apos;t be its ends; the side&apos;s ends are its furthest bottom corners.
                  </li>
                  <li>
                    <B>Photo</B>: step back until the whole side is on the screen, both ends, the bottom and the roof edge over it, hold
                    still and press it. The first press shows how; press again to take it. Turn the phone on its side for a wide wall. A
                    side too long or too tight for one photo takes two or three, each of a part. The line says what is out of frame:{" "}
                    <Q>Photo 1 of Front kept · the whole side is in it</Q>. Where two roofs meet is worth a photo too.
                  </li>
                  <li>
                    <strong>On a gable end</strong>, take one photo facing the wall straight on, from two or three steps to one side of
                    the peak, the peak and both slopes of the roof edge in view: Scrivn reads the roof&apos;s pitch and how far the rake
                    stands out from it. Then, once for the
                    house, at a corner where the roof edge ends plainly (not over a porch, a deck or a lower roof), step out past the corner
                    and take one more from the gable side at about 45&deg;, the end of the roof edge near the middle of the screen: that
                    gives the eave overhang. The first photo of a gable shows a card that says so.
                  </li>
                  <li>
                    <B>Next side</B>, and walk round to it, either way round the house. If the side you are leaving has no photo, it reminds
                    you once: <Q>No photo of Front yet · step back so all of it is in view and press Photo – or Next side again</Q>. Then
                    the new side&apos;s two bottom corners: <Q>Next side – tap its two bottom corners, 1-3 m from the wall.</Q>
                  </li>
                </ol>
              </div>
              <figure className="sg-fig">
                <ExteriorSide />
                <figcaption>
                  One side face-on: its two bottom corners first, then round the stucco to close it; a window and a door at two opposite
                  corners of their openings.
                </figcaption>
              </figure>
            </div>
            <div className="sg-split">
              <div>
                <h3 className="sg-h3">Round the house</h3>
                <ul className="sg-list">
                  <li>
                    Scan names the sides by which way they face: <strong>Front</strong>, then <strong>Right</strong>,{" "}
                    <strong>Rear</strong> and <strong>Left</strong> (and <em>Front 2</em> for a second front-facing wall). Rename one on
                    the plan.
                  </li>
                  <li>
                    <strong>A hidden corner doesn&apos;t matter.</strong> Each side taps its own bottom corners, and the house corner is
                    where two sides&apos; bottom lines cross. Behind a deck or a hedge, tap any point on the wall&apos;s bottom line
                    within about 13 ft of the corner, a deck post on the line say.
                  </li>
                  <li>
                    <strong>Closing the lap:</strong> there&apos;s no button. When the last side&apos;s bottom line meets the first
                    side&apos;s, the footprint closes by itself.
                  </li>
                  <li>
                    <strong>Check it on the plan</strong> (tap the mini-map): it shows one side at a time, face-on, with <B>‹</B>{" "}
                    <B>›</B> to go round, its name to rename it, <B>Undo</B> and <B>Close</B>. Under it, the side&apos;s length, heights,
                    areas, windows and doors, and the footprint: <Q>Footprint: 3 corners joined – go on round</Q> until it closes, then{" "}
                    <Q>Footprint closed: 4 sides, 1640 SF</Q>.
                  </li>
                  <li>
                    <strong>Tape one side</strong>, the longest you can run a tape along, corner to corner at the bottom. On the plan, tap
                    that side&apos;s length and type it: <Q>Every length and height on every side scales to it.</Q> One tape scales the
                    whole house.
                  </li>
                  <li>
                    <strong>If tracking drops</strong> it asks for a bottom corner again: <Q>Tracking restarted – tap the Front&apos;s left
                    bottom corner again (Undo skips it).</Q> Tap it where it was. If the map turned, it asks for the side&apos;s other
                    bottom corner too, then <Q>Linked – go on.</Q>
                  </li>
                  <li>
                    <B>Stop</B>, then <B>Send</B>: the exterior goes into a claim with its photos, no storey asked:{" "}
                    <Q>Sent to Scrivn: the exterior (4 sides) as a new claim</Q>. <B>Share</B> makes plans of rooms only, so an exterior
                    goes to Scrivn by Send.
                  </li>
                </ul>
              </div>
              <figure className="sg-fig">
                <ExteriorRound />
                <figcaption>Seen from above: each side&apos;s own two corners; the house corners are where the lines cross.</figcaption>
              </figure>
            </div>
            <h3 className="sg-h3">What Scrivn does with it</h3>
            <ul className="sg-list">
              <li>
                The exterior opens in the claim&apos;s sketch, in <strong>Exterior</strong>: the plan and roof first, then each side
                face-on and to scale, with its cladding areas before and after openings, trim and corners.
              </li>
              <li>
                <strong>The roof</strong> is built from the footprint. With no pitch typed, read off a gable&apos;s photo or tapped up
                to a gable&apos;s peak, it is drawn at an <strong>assumed 4/12</strong>, marked assumed on the plan, the scope and the
                documents until you change it. Gable or hip at each end, porches, cross gables and lower roofs are set there, and every roof line has its
                length. It is a roof estimate from the footprint and pitch, not an aerial roof report.
              </li>
              <li>
                Each side&apos;s photo is squared up behind its elevation. <strong>AI trace</strong> reads the cladding, windows and
                doors off it for you to tick and put on the side, and the roof&apos;s edge: a gable&apos;s pitch from its two slopes,
                how far the rake and the eave stand out, and whether the roof is a gable or a hip there. Each is its own tick; what you
                tick fills the roof <strong>from photos</strong>, and anything you type wins over it.
              </li>
              <li>There is a 3D view of the house, siding and roof.</li>
              <li>
                No Scan? The outside can be drawn by hand in Scrivn, side by side or corner by corner. Scrivn&apos;s Help shows how.
              </li>
            </ul>
          </Section>

          <Section id="account" title="Your account and free scans">
            <div className="sg-split">
              <div>
                <p>
                  <B>Account</B> is at the top left whenever you&apos;re not capturing. You don&apos;t need an account to measure or to
                  share a plan.
                </p>
                <ul className="sg-list">
                  <li>
                    <strong>Not signed in</strong>, it offers <B>Sign in</B> (your Scrivn email and password), <B>Create an account</B>,{" "}
                    <B>Pair with a code from Scrivn</B> and <B>Delete an account</B>.
                  </li>
                  <li>
                    <strong>Accounts are by invitation for now.</strong> Create an account says <Q>Accounts are by invitation</Q> until
                    Scrivn opens sign-up to everyone. If you&apos;ve been given an account, sign in; to ask for one, write to us at{" "}
                    <a href="/contact">scrivn.ca/contact</a>.
                  </li>
                  <li>
                    <strong>Signed in</strong>, it shows your name and company, your email, your scans this month, and{" "}
                    <Q>Scans you send go into this account&apos;s claims in Scrivn.</Q> <B>Sign out</B> stops this phone sending to the
                    account; scans already sent stay there.
                  </li>
                  <li>
                    <B>Delete account</B> asks for your password. It deletes your sign-in and details and signs the phone out. If nobody
                    else is in your company&apos;s account, its claims, scans and photos are deleted too, and any plan is cancelled. It
                    can&apos;t be undone. Scan still works without an account afterwards. You can also delete it at{" "}
                    <a href="/account/delete">scrivn.ca/account/delete</a>.
                  </li>
                </ul>
                <h3 className="sg-h3">Free scans</h3>
                <ul className="sg-list">
                  <li>
                    <strong>A scan is one capture</strong>: everything from Start to the next Start, all its rooms, levels and exterior.
                  </li>
                  <li>
                    It counts <strong>once</strong>, the first time it leaves the phone: sent to Scrivn or shared as a plan. Sending it
                    again, or sharing it after sending it, doesn&apos;t count again. A phone with no account isn&apos;t counted at all.
                  </li>
                  <li>
                    A Scrivn account with no plan has <strong>3 a month</strong>. Any Scrivn plan, or the Scan plan, is unlimited.
                  </li>
                  <li>
                    <strong>While Scan is in testing nothing is refused</strong>: scans are counted, and Account says{" "}
                    <Q>Unlimited scans while Scrivn Scan is in testing (2 scans this month).</Q>
                  </li>
                </ul>
              </div>
              <figure className="sg-fig">
                <AccountSheet />
                <figcaption>Account, not signed in.</figcaption>
              </figure>
            </div>
          </Section>

          <Section id="scrivn" title="Sending to Scrivn (optional)">
            <div className="sg-split">
              <div>
                <p>If you have a Scrivn account, Scan sends rooms straight into a claim.</p>
                <ol className="sg-steps">
                  <li>
                    <strong>Sign in once.</strong> <B>Account</B> → <B>Sign in</B>, with your Scrivn email and password (
                    <See id="account" />
                    ). Or pair instead: in Scrivn, open your Account page and press <strong>Pair a phone</strong>, then on the phone tap{" "}
                    <B>Account</B> → <B>Pair with a code from Scrivn</B> → <B>Scan code</B> and point it at the QR code (or{" "}
                    <B>Type code</B> for the eight letters). Until then the Send button reads <B>Sign in</B>.
                  </li>
                  <li>
                    After a capture, press <B>Stop</B>, then <B>Send</B>. Pick the claim (or <B>New claim</B>) and the storey.
                  </li>
                  <li>
                    The rooms go over with their names, ceilings, doors (and their kind), windows, cabinets and fixtures; the wet lines,
                    readings and painted floors and ceilings; every level as its own storey; the exterior and its side photos; and the
                    walk&apos;s 360° photos for a walk-through capture.
                  </li>
                  <li>
                    <B>Open in Scrivn</B> takes you to the claim&apos;s sketch. Scrivn may offer to fill in closets and spaces between rooms
                    that weren&apos;t tapped.
                  </li>
                  <li>
                    No signal? Send anyway: it waits on the phone and goes by itself (<See id="signal" />).
                  </li>
                </ol>
              </div>
              <div className="sg-figs">
                <Drawing name="send" caption="Sign in or pair once, then pick the claim." />
              </div>
            </div>
          </Section>

          <Section id="signal" title="No signal">
            <p>Basements and rural jobs often have one bar or none. Both apps keep working.</p>
            <div className="sg-cards sg-cards-2">
              <div className="sg-card">
                <h3>In Scan</h3>
                <ul className="sg-list">
                  <li>
                    <strong>Measuring needs no signal.</strong> Rooms, levels, moisture, the exterior, 360s, Review and the tape all work
                    on the phone alone.
                  </li>
                  <li>
                    <B>Share</B> works too. Signed in, it is counted when the signal is back.
                  </li>
                  <li>
                    <B>Send</B> lists the claims the phone last saw (<Q>Send to which claim? (no signal – the list from …)</Q>), or{" "}
                    <B>New claim</B>. Then:{" "}
                    <Q>No signal – the scan and its photos are saved on this phone and go to Scrivn on their own when there is signal. Keep working, or close the app: it is not lost.</Q>
                  </li>
                  <li>
                    Over the buttons it says <Q>1 scan waiting to send – it goes on its own when there is signal</Q>. Tap it to see what is
                    waiting, or <B>Send now</B>. Pressing Start or closing the app doesn&apos;t lose it.
                  </li>
                  <li>
                    Signing in, creating an account and <B>Report a problem</B> need a connection; a report that can&apos;t go offers{" "}
                    <B>Try again</B>.
                  </li>
                </ul>
              </div>
              <div className="sg-card">
                <h3>In Scrivn</h3>
                <ul className="sg-list">
                  <li>
                    Claims you&apos;ve opened on the device open without signal, and new ones can be started. Everything saves on the
                    device and syncs on its own when the signal is back. The header says <strong>Offline</strong> and how much is waiting.
                  </li>
                  <li>
                    The sketch, the moisture map, the drying log and the exterior all work offline. Photos are kept on the device and
                    upload by themselves.
                  </li>
                  <li>
                    Reading the walkthrough, generating the documents and AI trace wait for signal, then run by themselves. Reading a
                    meter&apos;s screen from a photo needs signal: type the number instead.
                  </li>
                  <li>
                    If the same claim was changed somewhere else in the meantime, Scrivn keeps both and asks which you want.
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <Section id="tips" title="Tips that make the numbers right">
            <p>These come from walking real houses with the app. Each one fixed something we saw go wrong.</p>
            <div className="sg-tips">
              <div className="sg-tip">
                <h3>Always tape at least one wall</h3>
                <p>
                  Best practice in every room: tape the longest wall and type it in on Review. It checks the phone against a real
                  measurement and sets the plan&apos;s scale. In a dim room tape two. If every wall reads short by about the same, tick{" "}
                  <strong>Scale the whole room to this wall</strong>.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Turn the lights on</h3>
                <p>
                  In dim rooms the walls read short, by 2% to 7% (a 12 ft wall coming in 3 to 10 in short). Doors and windows read true either
                  way. If a room is dim the line says <Q>Room&apos;s dim — turn the lights on for truer lengths</Q>.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Mind mirrors and glass</h3>
                <p>
                  The depth camera can&apos;t read a mirror or glass, and a big mirror can throw the phone off its place. Tap corners from
                  where the mirror is out of view; for a corner in or behind one, use <B>Can&apos;t reach</B> on the walls either side.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Aim where the corner is clear</h3>
                <p>
                  A sofa, a TV or a shelf in front of the corner makes it read short. Aim above or below the clutter, wherever you can see
                  the crease where the walls meet.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Stay in the middle</h3>
                <p>
                  Tap every corner from one spot near the middle, 6 to 8 ft away. Walking to each corner and tapping it close up is slower
                  and reads worse.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Move slowly, keep it pointed at things</h3>
                <p>
                  Turn slowly and walk through doorways looking ahead, not at the floor or a bare wall. Most tracking drops are a fast turn
                  or a blank view.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Doorways from both sides</h3>
                <p>
                  Tap every shared doorway in both rooms and join the room there. It&apos;s the one thing that lines the rooms up exactly,
                  even after a drop.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Check Review before you leave</h3>
                <p>
                  A quick look at the plan in the room catches a wrong corner while you can still tap it again. <B>Undo</B> is always
                  safe.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Big closets are rooms</h3>
                <p>
                  A walk-in or anything bigger than the dashed box: tap it as its own room and join it at its closet door.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Outside: the opening, not the frame</h3>
                <p>
                  Windows tapped on the frame or the glass came in 4 to 6 in short. Aim at the corners of the opening in the stucco or
                  siding.
                </p>
              </div>
              <div className="sg-tip">
                <h3>Outside: one photo and one tape</h3>
                <p>
                  Take a photo of every side with the whole side in it, and tape one side corner to corner. The tape sets the scale of
                  every side, and the photos let Scrivn check and trace each one.
                </p>
              </div>
            </div>
          </Section>

          <Section id="report" title="Send us a scan that went wrong">
            <div className="sg-split">
              <div>
                <p>
                  This is the most useful thing you can do as a tester. Every fix so far started with a scan like yours and its log, which
                  is the app&apos;s own record of what it saw and decided, tap by tap.
                </p>
                <ol className="sg-steps">
                  <li>
                    Open Review (tap the mini-map) and tap <B>Report a problem</B> at the top right. During a capture,{" "}
                    <B>More…</B> → <B>Send this scan to the Scrivn team</B> does the same.
                  </li>
                  <li>
                    Say what went wrong: <strong>which room, which wall or corner, what you expected</strong>, and the tape measurement if
                    you have one. &ldquo;Bedroom 2, wall 3 came in 6 in short, tape says 11&apos;2&rdquo; tells us exactly where to look.
                  </li>
                  <li>
                    Add your name or email if you&apos;d like us to reply. Then <B>Send</B>.
                  </li>
                </ol>
                <div className="sg-warn">
                  <strong>Did the room more than once?</strong> Report after the last run. The scan on the screen goes, and so does the
                  app&apos;s recent log, with every run before it since the app was opened.
                </div>
                <p className="sg-small">
                  What&apos;s sent: the scan&apos;s measurements, the app&apos;s recent log (this run and any others since the app was
                  opened), your phone&apos;s model and Android version, and what you write. No photos. It works with or without a Scrivn
                  account, but it needs an internet connection; if it can&apos;t send, it says so and offers <B>Try again</B>.
                </p>
                <p className="sg-small">
                  Something that isn&apos;t about a scan (the app crashed, a button doesn&apos;t make sense)? Report it the same way; a note
                  with no scan is fine.
                </p>
              </div>
              <figure className="sg-fig">
                <ReportDialog />
                <figcaption>Report a problem: a note, and how to reach you if you&apos;d like a reply.</figcaption>
              </figure>
            </div>
          </Section>

          <Section id="known" title="Rough edges we know about">
            <ul className="sg-list">
              <li>
                <strong>Thin partition ends</strong> (<B>Wall end</B>) are hard to hit cleanly from across a room. If one won&apos;t
                come in, leave it out.
              </li>
              <li>
                <strong>Corners behind furniture</strong> and <strong>dim rooms</strong> read short. Tape a wall (see the tips).
              </li>
              <li>
                <strong>Dark stairwells and long bare hallways</strong> are where tracking drops most.
              </li>
              <li>
                <strong>Stop finishes the capture.</strong> After it the chip bar and <B>More…</B> are gone, and <B>Start</B> begins a new,
                empty capture. Look over Review before you press Stop; a missed doorway can still go on afterwards with a long press on
                Review.
              </li>
              <li>
                <strong>A wet line can&apos;t be changed after its box is closed.</strong> <B>Undo</B> it and tap it again.
              </li>
              <li>
                <strong>The outside has no roof from Scan.</strong> Scan measures the siding; Scrivn draws the roof from the footprint at an
                assumed pitch until you give it the real one. <B>Share</B> makes no plan of an exterior: send it to Scrivn.
              </li>
            </ul>
            <p>
              Questions, or a phone that won&apos;t run it? Email <a href="mailto:contact@scrivn.ca">contact@scrivn.ca</a>.
            </p>
          </Section>
        </div>
      </div>
    </MarketingShell>
  );
}
