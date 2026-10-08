import QRCode from "qrcode";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { appUrl } from "@/lib/deviceCodes";
import { CaptureScreen, ClosetStep, DropAsk, HowtoArt, JoinRooms, ReportDialog, ReviewScreen, Ring, SpinDots } from "@/components/scanGuide/Figures";
import type { HowtoName } from "@/components/scanGuide/howtoDrawings";
import "./scan-guide.css";

/**
 * The tester guide for Scrivn Scan (2026-10-07): how to use it, tips from the walks so far, and how
 * to send us a scan that went wrong. Public and static - a tester reads it on the phone they scan
 * with, with no Scrivn account - and written for Scan as a product of its own: pairing with Scrivn
 * is one section near the end.
 *
 * Every button and line quoted here is the app's own word (res/values/strings.xml, Copy.kt,
 * Instructions.kt); when the app's wording changes, this page changes with it. The drawings in
 * public/scan-guide are the app's how-to pictures (scripts/howto-svgs.py); the screens are drawn in
 * components/scanGuide/Figures.tsx.
 */
export const metadata = {
  title: "Scrivn Scan — Tester Guide",
  description: "How to measure rooms with Scrivn Scan, tips that make the numbers right, and how to send us a scan that went wrong.",
};

const SECTIONS = [
  ["start", "Before you start"],
  ["screen", "The capture screen"],
  ["ring", "The ring"],
  ["room", "Measure a room"],
  ["openings", "Doors, windows and openings"],
  ["fixtures", "Cabinets, tubs and showers"],
  ["more", "Stairs, ceilings and the awkward bits"],
  ["rooms", "More than one room"],
  ["drops", "When tracking drops"],
  ["review", "Review: check it, tape it"],
  ["spins", "360° photos"],
  ["scrivn", "Sending to Scrivn (optional)"],
  ["tips", "Tips that make the numbers right"],
  ["report", "Send us a scan that went wrong"],
  ["known", "Rough edges we know about"],
] as const;

function B({ children }: { children: React.ReactNode }) {
  // A button or chip in the app, by its label.
  return <span className="sg-btn">{children}</span>;
}

function Q({ children }: { children: React.ReactNode }) {
  // A line the app shows, quoted.
  return <span className="sg-quote">{children}</span>;
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="sg-section">
      <h2>
        <span className="sg-num" aria-hidden="true">
          {n}
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
            the floor plan with every wall, door, window and cabinet on it. Thank you for testing it. This page shows how it works,
            what gets the best numbers, and how to send us a scan that came out wrong. That last part is what helps us most.
          </p>
        </header>

        <div className="wrap-narrow">
          <div className="sg-quick">
            <h2>The short version</h2>
            <ol>
              <li>
                Install the test version from <a href="/scan-download">scrivn.ca/scan-download</a> (section 1).
              </li>
              <li>
                Turn the room&apos;s lights on. Press <B>Start</B>, then hold the phone up and walk a few steps until the ring turns green.
              </li>
              <li>Stand near the middle of the room. Aim the ring at each corner, 6 to 8 ft away, and tap the screen. Go round the room.</li>
              <li>Tap corner 1 again to close the room. Then tap each door, window and opening at its two sides.</li>
              <li>
                Open the plan (the little map, top right). <strong>Tape at least one wall in every room</strong>, the longest, then tap
                its length and type what your tape says. <B>Share</B> sends the plan as a PDF and a JPG, to scale.
              </li>
              <li>
                Next room: <B>Add room</B>, tap its corners, tap the doorway you came through, then <B>More…</B> → <B>Join this room to another</B>.
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

          <Section id="start" n={1} title="Before you start">
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
                <Q>This phone does not support the ARCore Depth API</Q>. Please tell us which phone it was.
              </li>
              <li>
                <strong>First open.</strong> Allow the camera (it is how Scan measures) and let Android install or update{" "}
                <em>Google Play Services for AR</em> if it asks.
              </li>
              <li>
                <strong>No account needed.</strong> Scan works on its own: the plan is on the Review screen, and <B>Share</B> sends it as a
                PDF and a JPG. Pairing it with a Scrivn account to send rooms into a claim is optional (section 12).
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

          <Section id="screen" n={2} title="The capture screen">
            <div className="sg-split">
              <figure className="sg-fig sg-phonefig">
                <CaptureScreen />
                <figcaption>The capture screen, drawn. The numbers match the list.</figcaption>
              </figure>
              <ol className="sg-legend">
                <li>
                  <B>Stop</B> finishes the capture. After it the bottom row reads <B>Start</B> · <B>Share</B> · <B>Send</B>. A long press
                  on Share saves the capture&apos;s files for us; you won&apos;t need it.
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
                  <strong>The chips.</strong> What your next tap is: <B>Corner</B>, <B>Door</B>, <B>Opening</B>, <B>Window</B>, and{" "}
                  <B>More…</B> for everything else (closet doors, cabinets, tubs, stairs and the rest). The lit chip is green.
                </li>
                <li>
                  <B>Undo</B> takes back the last tap, so use it freely. <B>360°</B> takes a 360° photo (walk-through captures only).{" "}
                  <B>?</B> explains the lit chip. <B>Add room</B> starts the next room in the same capture.
                </li>
              </ol>
            </div>
          </Section>

          <Section id="ring" n={3} title="The ring">
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
                  <strong>Red, &ldquo;tracking…&rdquo;.</strong> The phone has lost the room. Taps are ignored until it finds it again (section 9).
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

          <Section id="room" n={4} title="Measure a room">
            <div className="sg-split">
              <div>
                <ol className="sg-steps">
                  <li>
                    Press <B>Start</B>. It asks what you are capturing: <B>Sketch only</B>, or <B>Sketch + walk-through</B> if you also
                    want 360° photos of the rooms.
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
                    <Q>Room closed · W × D · N corners — openings next, or Add room</Q>. The chip moves to <B>Door</B> for you.
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

          <Section id="openings" n={5} title="Doors, windows and openings">
            <div className="sg-split">
              <div>
                <ul className="sg-list">
                  <li>
                    <B>Door</B>, <B>Opening</B> (a doorway with no door) and <B>Closet door</B> (on <B>More…</B>) are two taps:{" "}
                    <strong>its left jamb, then its right jamb</strong>. Keep the ring on the frame, not the gap. Aim a hand-width onto
                    the wall beside it. The line confirms the width: <Q>Door 1 · 2&apos;8&quot;</Q>.
                  </li>
                  <li>
                    <B>Window</B> is two taps on the outside of the casing: <strong>the bottom of its left edge, then the top of its right
                    edge</strong>. Those two taps give the width, the sill and the head.
                  </li>
                  <li>The chip stays lit after an opening, so you can go straight on to the next one.</li>
                  <li>
                    <strong>Closets:</strong> tap a closet&apos;s door with <B>Closet door</B>, not <B>Door</B>. Before Send, Scan asks
                    about each closet door; see section 10.
                  </li>
                </ul>
              </div>
              <div className="sg-figs">
                <Drawing name="opening" caption="An opening is its two jambs." />
              </div>
            </div>
          </Section>

          <Section id="fixtures" n={6} title="Cabinets, tubs and showers">
            <div className="sg-split">
              <div>
                <ul className="sg-list">
                  <li>
                    On <B>More…</B>, pick <B>Cabinet – base</B>, <B>Cabinet – wall</B> or <B>Cabinet – full</B>. Each run is two taps,
                    one at each end. Aim at the <strong>wall above it</strong> or at the <strong>face of the cabinet</strong>, whichever
                    you can see.
                  </li>
                  <li>
                    At an inside corner, tap each run as far as you can see it and stop. The corner cabinet fills itself in. A gap wider
                    than a cabinet is read as an appliance (a fridge, a dishwasher) and left alone.
                  </li>
                  <li>
                    A run out in the floor is an <strong>island</strong>. It asks for a third tap on its back edge, which gives its depth.
                  </li>
                  <li>
                    <B>Tub</B> and <B>Shower</B> (also on <B>More…</B>) are tapped the same way: the wall above each end. A tub that nearly
                    fills its alcove is stretched to fit it.
                  </li>
                </ul>
              </div>
              <div className="sg-figs">
                <Drawing name="cabinet" caption="A run on the wall is two taps; an island is two, then its back edge." />
              </div>
            </div>
          </Section>

          <Section id="more" n={7} title="Stairs, ceilings and the awkward bits">
            <p>Everything here is on <B>More…</B>. Each has its own drawing in the app (tap <B>?</B> once it is lit).</p>
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
                  Aim at the ceiling and tap: one tap is the height. For a slope or a vault, tap the high side, then where the ceiling meets
                  the wall at its low side. You can also set it on Review.
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

          <Section id="rooms" n={8} title="More than one room">
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

          <Section id="drops" n={9} title="When tracking drops">
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

          <Section id="review" n={10} title="Review: check it, tape it">
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
                    phone&apos;s reading against a real measurement and sets the plan&apos;s scale. Two walls in a dim room.
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
                <h3 className="sg-h3">The closets step</h3>
                <p>
                  When you press Send, Review shows each closet door in turn with a dashed <strong>Closet?</strong> box behind it. Tap the
                  box if there&apos;s a closet there and it&apos;s drawn in; leave it if not. <B>Next closet</B> moves on and the last one
                  reads <B>Send</B>. A closet bigger than the box? <B>Back</B>, then tap it as a room of its own and join it at its door.
                </p>
                <figure className="sg-fig">
                  <ClosetStep />
                  <figcaption>The closets step: tap the dashed box to draw the closet in.</figcaption>
                </figure>
              </div>
            </div>
          </Section>

          <Section id="spins" n={11} title="360° photos">
            <div className="sg-split">
              <div>
                <p>
                  Start with <B>Sketch + walk-through</B> to take 360° photos. Take them <strong>after the room is closed</strong>.
                </p>
                <ol className="sg-steps">
                  <li>
                    The mini-map shows amber rings where 360s are wanted (a dot turns green once done). Stand on one and press <B>360°</B>.
                  </li>
                  <li>
                    Hold still while it sets up (<Q>360° – hold still a moment</Q>). The wide camera takes over the screen.
                  </li>
                  <li>
                    Turn slowly on the spot. Hold the ring on the amber dot until its arc fills and it turns into a green tick. Then the next
                    dot. There are 12 round the room at eye level, then 6 on the floor: tilt down when the line says so.
                  </li>
                  <li>
                    It ends by itself after the 18th dot (or press <B>360°</B> again to stop early; half the dots or more is kept).
                  </li>
                </ol>
                <p className="sg-note">
                  If it says <Q>Tap corner N again first – then the 360</Q>, the phone has to find the room before it can place the
                  photo: tap that corner, then press <B>360°</B> again.
                </p>
              </div>
              <figure className="sg-fig">
                <SpinDots />
                <figcaption>Turn on the spot; hold the ring on each amber dot until it fills.</figcaption>
              </figure>
            </div>
          </Section>

          <Section id="scrivn" n={12} title="Sending to Scrivn (optional)">
            <div className="sg-split">
              <div>
                <p>If you have a Scrivn account, Scan sends rooms straight into a claim.</p>
                <ol className="sg-steps">
                  <li>
                    <strong>Pair once.</strong> On a phone that isn&apos;t paired, the button reads <B>Pair</B>. In Scrivn, open your
                    Account page and press <strong>Pair a phone</strong>. Then on the phone tap <B>Pair</B> → <B>Scan code</B> and point it
                    at the QR code (or <B>Type code</B> for the eight letters).
                  </li>
                  <li>
                    After a capture, press <B>Stop</B>, then <B>Send</B>. Pick the claim (or <B>New claim</B>) and the storey. The rooms go
                    over with their names, ceilings, doors, windows and cabinets, and with the walk&apos;s photos for a walk-through capture.
                  </li>
                  <li>
                    <B>Open in Scrivn</B> takes you to the claim&apos;s sketch. Scrivn may offer to fill in closets and spaces between rooms
                    that weren&apos;t tapped.
                  </li>
                </ol>
              </div>
              <div className="sg-figs">
                <Drawing name="send" caption="Pair once, then pick the claim." />
              </div>
            </div>
          </Section>

          <Section id="tips" n={13} title="Tips that make the numbers right">
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
            </div>
          </Section>

          <Section id="report" n={14} title="Send us a scan that went wrong">
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
                  opened), your phone&apos;s model and Android version, and what you write. No photos. It works with or without a Scrivn account, but it needs an internet connection; if it
                  can&apos;t send, it says so and offers <B>Try again</B>.
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

          <Section id="known" n={15} title="Rough edges we know about">
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
