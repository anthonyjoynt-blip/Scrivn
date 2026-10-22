import QRCode from "qrcode";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { appUrl } from "@/lib/deviceCodes";
import { ASSUMED_PITCH } from "@/lib/exterior";
import {
  AccountSheet,
  CaptureScreen,
  ClosetStep,
  CornerTapes,
  DoorSheet,
  DropAsk,
  HowtoArt,
  JoinRooms,
  MeasureCard,
  MoistureRoom,
  PhotoShots,
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
 * Instructions.kt); when the app's wording changes, this page changes with it. The drawings in
 * public/scan-guide are the app's how-to pictures (scripts/howto-svgs.py); the screens are drawn in
 * components/scanGuide/Figures.tsx.
 *
 * Brought up to Scan 0.1.157 on 2026-10-14: the two chip rows, levels, moisture as you go, door
 * types, the 360 step at the end, the Account screen and free scans, and what happens with no
 * signal. What Scrivn does with a scan is told in Scrivn's own Help.
 *
 * The outside of the house since 2026-10-19: PHOTOS ONLY, in Scrivn, not Scan (Scan's Exterior sketch is put away). The
 * section teaches Scrivn's "From photos" (components/sketch/PhotoRoute.tsx, TeamMeasure.tsx, RoofCheck.tsx, QuickBox.tsx)
 * in its own words; the old lap of corner taps, the Sizes card and Finish exterior on the phone are gone from this page.
 * Since 2026-10-21 the way in is the walk round the house (components/sketch/PhotoWalk.tsx): the section follows its
 * steps and its own words, then measuring it yourself and Send to Scrivn team.
 */
export const metadata = {
  title: "Scrivn Scan — Tester Guide",
  description:
    "How to measure rooms with Scrivn Scan, measure the outside of a house from photos in Scrivn, map moisture as you go, tips that make the numbers right, and how to send us a scan that went wrong.",
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
  ["exterior", "Outside of the house: from photos"],
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
            the floor plan with every wall, door, window and cabinet on it. It maps wet walls and floors as you go. The outside of the
            house is measured in Scrivn, from photos. Thank you for testing it. This page shows how it works, what gets the best numbers,
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
                Outside: that&apos;s Scrivn, not Scan. In the claim, <B>Exterior</B> → <B>From photos</B>, and Scrivn walks you round
                the house a step at a time: the front, each corner at 45°, each side straight on, a measurement or two. Then{" "}
                <B>Send to Scrivn team to measure</B> (<See id="exterior" />).
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
                    Press <B>Start</B>. It asks what you are capturing: <B>Sketch only</B>, or <B>Sketch + walk-through</B> if you also
                    want 360° photos of the rooms. The outside of the house is done in Scrivn (<See id="exterior" />).
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

          <Section id="exterior" title="Outside of the house: from photos">
            <p>
              The outside isn&apos;t measured in Scan. It&apos;s done in <strong>Scrivn</strong>, from photos taken with the phone&apos;s own
              camera, on any phone, iPhone too. Scrivn walks you round the house one step at a time: the front, then each corner and
              each side, a photo at each and a measurement where you have one. Then send it to the Scrivn team, or measure it
              yourself.
            </p>
            <div className="sg-split">
              <div>
                <h3 className="sg-h3">Round the house, in any order</h3>
                <ol className="sg-steps">
                  <li>
                    <strong>Outside of the house, then From photos.</strong> On the claim, <B>Outside of the house</B> opens the sketch
                    straight on its Exterior; then <B>From photos</B>. The <B>Exterior report (PDF)</B> sits right under it once the
                    outside is measured.
                  </li>
                  <li>
                    <strong>Say the corners.</strong> The list starts with the front. Under it, <B>+ Outside corner</B>,{" "}
                    <B>+ Inside corner</B> or <B>+ Joins the neighbour</B> adds the next corner round and the wall after it: corner 1
                    is the front&apos;s right-hand end, then on round with the house on your left. Say them as you come to them, or all
                    at once. <B>Take back</B> undoes the last. The house&apos;s shape comes from them: nothing to draw.
                  </li>
                  <li>
                    <strong>Photos, any order.</strong> Tap any wall or corner in the list to put photos on it: every wall straight
                    on, every outside corner at 45° stepped back until three corners are in, more than one where a wall is long or
                    broken up (above or below a deck is fine: <B>Take more of this wall</B>). A tight side yard: the phone upright, on
                    the 1x lens. Each ticks off as its photos come in; an inside corner needs none.
                  </li>
                  <li>
                    <strong>Add a measurement</strong>, any time: which wall, what (<B>Garage door</B> with <B>9′</B>/<B>16′</B>,{" "}
                    <B>Window</B>, <B>Door</B>, <B>Wall</B>), its size in feet, inches and an eighth, and{" "}
                    <B>Photo of the tape on it</B> if you can: close up, the number and both ends of the tape. At least one for scale,
                    ideally one a wall. Nothing is drawn on the phone.
                  </li>
                  <li>
                    <strong>Finish</strong> whenever you&apos;re done. What&apos;s still missing is said above it (walls or corners
                    with no photo, no measurement, corners that don&apos;t close round to the front), never forced. <B>Back to the
                    walk</B> opens it again.
                  </li>
                  <li>
                    <strong>Send to Scrivn team to measure</strong>, at the end. That&apos;s all a tester needs to do: we place each
                    measurement on its photo exactly. Or <B>Measure it here</B>: see below.
                  </li>
                </ol>
                <p>
                  Every step is saved as you take it, on the phone first: no signal is fine, and a walk half done picks up where you
                  left it. <B>Back a step</B> and <B>Take it again</B> are on every step. <B>Add photos my own way</B> leaves the walk
                  for the old way (draw the shape, add photos, tap corners); <B>Back to the step-by-step walk</B> returns to it.
                </p>
              </div>
              <figure className="sg-fig">
                <PhotoShots />
                <figcaption>Where to stand, seen from above: the front and each wall straight on, every outside corner at 45°.</figcaption>
              </figure>
            </div>
            <div className="sg-split">
              <div>
                <h3 className="sg-h3">Good photos</h3>
                <ul className="sg-list">
                  <li>
                    <strong>Sideways, on the 1x lens.</strong> The normal camera, held landscape. Not the wide lens, and no zoom.
                    Upright only for a side too tight to step back from.
                  </li>
                  <li>
                    <strong>The 45° photos matter most.</strong> Step back far enough for three corners: the one you&apos;re at and
                    the far end of each wall. They hold the measurement together, the back corners and the ones behind a porch or
                    deck too. A photo that shows just one corner of the house helps much less.
                  </li>
                  <li>
                    <strong>Each gable square-on</strong>, the peak and both slopes of the roof edge in it.
                  </li>
                  <li>
                    <strong>Door heights are not a good ruler.</strong> Doors vary too much. Use a tape or the garage door.
                  </li>
                  <li>
                    <strong>One tape front to back</strong>, if you have a long one: the long side wall, front corner to back corner,
                    at the ground. Put it in as that side&apos;s measurement: <B>Wall</B>.
                  </li>
                </ul>
                <h3 className="sg-h3">Measuring it yourself</h3>
                <p>Easiest on a computer or a tablet: the photos are small on a phone.</p>
                <ol className="sg-steps">
                  <li>
                    <strong>Place the measurements.</strong> Each one typed on the walk is listed with <B>Place it</B>: drag its line
                    across it on its photo, end to end (the ring is where you tapped at the house). A wall&apos;s length is already its
                    side&apos;s, once the walk is round.
                  </li>
                  <li>
                    <strong>Tap the corners.</strong> <B>Measure it here</B> opens each photo of the walk in turn, with what to tap:
                    on a corner&apos;s photo, the corner where it meets the ground and the far end of each wall if you can see it; on
                    a side&apos;s, its two corners. Scrivn numbers them from what each photo was taken for. Tap a number to change
                    it. <B>Next photo</B> goes on round.
                  </li>
                  <li>
                    <strong>Measure.</strong> <B>Measure the house</B> gives each side&apos;s length and how sure it is (±).
                    Scrivn then marks more corners, dashed, where the measure puts them. Tap a wrong one to take it away or renumber
                    it. <B>Looks right</B> keeps the rest and measures again.
                  </li>
                  <li>
                    <strong>Check these.</strong> Only what the photos couldn&apos;t show for sure: is that tall glass a window or a
                    door? How far does the garage roof sit under the house&apos;s? One tap each. <B>Looks right</B> closes it, and
                    anything left stays as read.
                  </li>
                  <li>
                    <strong>The roof check</strong>, on <B>Plan &amp; roof</B>. The roof is drawn from the shape and the photos. Press
                    only what is wrong: <B>Gable</B> or <B>Hip</B> at an end, <B>+ Porch roof</B>, <B>+ Cross gable</B>. Then{" "}
                    <B>Looks right</B>. The pitch says assumed, {ASSUMED_PITCH}/12, until you type it.
                  </li>
                  <li>
                    <strong>The report.</strong> Each side opens face-on with its photo behind it, for its windows, doors and siding.{" "}
                    <B>Exterior report (PDF)</B> on the claim: the four elevations, the roof plan, the photos and every measurement.
                    Stucco trim (surrounds, keystones, columns) is counted apart from the field stucco.
                  </li>
                </ol>
              </div>
              <div className="sg-figs">
                <figure className="sg-fig">
                  <CornerTapes />
                  <figcaption>On a photo: the corners tapped at the ground, and a line across the garage door.</figcaption>
                </figure>
                <figure className="sg-fig">
                  <MeasureCard />
                  <figcaption>After Measure: each side with its ±, and the wall a tape would fix.</figcaption>
                </figure>
              </div>
            </div>
            <h3 className="sg-h3">Send to Scrivn team to measure</h3>
            <ul className="sg-list">
              <li>
                At the end of the walk (or beside Measure), <B>Send to Scrivn team to measure</B>. Add a note if you like (
                <Q>e.g. the side yard is too tight for a photo</Q>), then <B>Send</B>.
              </li>
              <li>
                We measure it from that claim&apos;s outside photos, measurements and note, and see nothing else. Meanwhile the Exterior
                says <Q>Sent to the Scrivn team – it&apos;ll show here when it&apos;s measured.</Q> Photos still on the phone go when
                there&apos;s signal. <B>Withdraw</B> takes it back.
              </li>
              <li>
                When it&apos;s done you get an email; its link opens the claim on the outside, which says <Q>Measured –</Q>{" "}
                <B>Use it</B>. A wall none of your photos faced asks first: <Q>no photo of this wall. Any windows or doors on it?</Q>{" "}
                <B>None</B>, or how many of each. Nothing else is asked: what the photos show is ours to read. Use it puts our
                measurements in, with what you said. Your photos and measurements stay. A wall still unanswered is drawn and
                reported <Q>Not photographed</Q>, never as a bare wall; you can answer on the wall itself later.
              </li>
            </ul>
            <div className="sg-cards sg-cards-2">
              <div className="sg-card">
                <h3>A shed or a garage</h3>
                <p>
                  <B>+ Add building</B> at the top of the Exterior, then <B>Shed</B>, <B>Detached garage</B> or <B>Workshop</B> (or type a
                  name). For a simple building, <B>Quick box</B>: its two lengths, the wall height, the roof, the siding, its doors and
                  windows. Or <B>From photos</B>: the same walk round it. Each building gets its own pages in the report.
                </p>
              </div>
              <div className="sg-card">
                <h3>Townhouses and semis</h3>
                <p>
                  Nothing to pick first. At the corner where your home meets the neighbour&apos;s, tap <B>Joins the neighbour</B>:
                  Scrivn takes the home as a semi (one such corner) or a middle townhouse (two). No 45° there: take the front at an
                  angle from that end instead, the whole front in.
                  The shared wall is skipped, not photographed or counted; at its far end, the back at an angle the same way. A middle
                  unit ends with two angled photos of the front and two of the back. Measuring it yourself, <B>Where this home
                  ends</B>: tap where this home ends at the ground, often a downspout, a trim line or where the colour changes.
                </p>
              </div>
            </div>
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
                    <strong>A scan is one capture</strong>: everything from Start to the next Start, all its rooms and levels.
                  </li>
                  <li>
                    It counts <strong>once</strong>, the first time it leaves the phone: sent to Scrivn or shared. Sending it again, or
                    sharing it after sending it, doesn&apos;t count again. A phone with no account isn&apos;t counted at all.
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
                    readings and painted floors and ceilings; every level as its own storey; and the walk&apos;s 360° photos for a
                    walk-through capture.
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
                    <strong>Measuring needs no signal.</strong> Rooms, levels, moisture, 360s, Review and the tape all work on the phone
                    alone.
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
                    <B>From photos</B> measures on the device, so the outside needs no signal either. <B>Send to Scrivn team to measure</B>{" "}
                    waits for signal and goes by itself.
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
                <h3>Outside: the corners at 45°</h3>
                <p>
                  The photo of each outside corner, both walls in, is what ties one wall to the next: the back corners too. Skip them
                  and the depth comes out short. Then tape the long side wall front to back, and any wall Scrivn flags (
                  <See id="exterior" />).
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
                <strong>The outside from photos is new.</strong> If a wall comes out wrong, tell us which and what your tape says, or
                send it to the Scrivn team to measure.
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
