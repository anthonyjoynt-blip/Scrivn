import Link from "next/link";

/**
 * How to use Scrivn, for reading at the desk.
 *
 * Deliberately NOT a copy of the phone's how-to. Scrivn Scan carries its own guide — every chip's
 * paragraph, with a drawing, in `More… → How to use this app` — written for somebody holding the
 * phone in a room, and the phone is the only place that text lives. Two copies of "how to tap a
 * corner" would be two things to keep true, and the one on the website is always the stale one.
 * The public tester guide at /scan-guide is the long version of the phone's, for testers.
 *
 * So this page teaches SCRIVN — the claim, the sketch, the exterior, the moisture map, the drying
 * log, photos, the documents — and says only enough about the phone to know what it is for and how
 * to connect it. Where the phone's own guide is the answer, it says so.
 *
 * Static: no claim data, nothing fetched. It renders inside the signed-in shell because that is
 * where somebody reading it already is, and it is linked from the footer of every page in the tool.
 * Brought up to date 2026-10-14: the exterior, the drying log, photos with spoken captions, Update
 * scope, and the phone's Account screen.
 */
export const metadata = {
  title: "Help — Scrivn",
  description: "How a claim moves through Scrivn, how the sketch, exterior, moisture map, drying log and photos work, and how the phone fits in.",
};

/** One drawing's worth of line art, in the same language as the phone's how-to. */
function Art({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg className="help-art" viewBox="0 0 160 110" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

const SECTIONS = [
  { id: "claim", title: "A claim, start to finish" },
  { id: "sketch", title: "The sketch" },
  { id: "exterior", title: "The outside of the house" },
  { id: "moisture", title: "The moisture map" },
  { id: "drying", title: "The drying log" },
  { id: "photos", title: "Photos" },
  { id: "documents", title: "The documents" },
  { id: "phone", title: "The phone" },
  { id: "wrong", title: "When something looks wrong" },
];

export default function HelpPage() {
  return (
    <main className="container help">
      <div className="card">
        <h1>Help</h1>
        <p className="field-note">
          How a claim moves through Scrivn, and what each part of it is for. The phone app carries its own guide —
          on it, <strong>More… → How to use this app</strong> — and the long version is the{" "}
          <Link href="/scan-guide">Scrivn Scan guide</Link>.
        </p>
        <nav className="help-contents" aria-label="On this page">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
      </div>

      <section className="card" id="claim">
        <h2>A claim, start to finish</h2>
        <p>
          A claim moves through four steps, and the bar at the top of each card says which one you are on. You can
          leave at any point — everything is saved as you go, and <Link href="/claims">Claims</Link> has it waiting.
        </p>
        <ol className="help-steps">
          <li>
            <strong>Claim Info.</strong> The customer, the job number, the insurer, the date of loss. Nothing here is
            clever; it is what ends up on the letterhead of every document.
          </li>
          <li>
            <strong>Transcript.</strong> Write up or dictate your walkthrough however you already do, and paste the
            text in. Scrivn does not record anything itself. Describe <em>the work</em>, not just the damage: &ldquo;the
            carpet is damaged&rdquo; will not become a line, &ldquo;tear out the carpet&rdquo; will.
          </li>
          <li>
            <strong>Follow-up Questions.</strong> Scrivn reads what you wrote against what a complete scope needs —
            materials, sizes, methods — and asks only about the gaps. Contents and remediation forms live alongside
            this step when the claim has them.
          </li>
          <li>
            <strong>Documents.</strong> A scope organised by phase and room, and an inspection report. Both carry your
            letterhead once one is set up in <Link href="/account">Account</Link>.
          </li>
        </ol>
        <p>
          Beside the steps, on the claim page, are the optional parts: <strong>Create sketch</strong> (
          <a href="#sketch">the sketch</a>, the outside and the moisture map), <strong>Drying log</strong> (
          <a href="#drying">each visit&rsquo;s readings</a>) and <strong>Photos</strong> (<a href="#photos">site photos with spoken
          captions</a>).
        </p>
        <p className="field-note">
          A claim is saved to your organisation, not to a device. Start one on a laptop and finish it on a phone.
        </p>
        <p className="field-note">
          <strong>No signal?</strong> Keep going. Claims you have opened on this device open without signal, and new ones
          can be started. Everything is saved on the device and syncs on its own when the signal is back — the header says
          Offline and how much is waiting. The sketch, the exterior, the moisture map and the drying log all work offline,
          and photos wait on the device and upload by themselves. Reading the transcript, generating the documents and AI
          trace wait for signal, then run by themselves; reading a meter from a photo needs signal, so type the number
          instead. If the same claim was changed somewhere else in the meantime, Scrivn keeps both and asks which you want.
        </p>
      </section>

      <section className="card" id="sketch">
        <h2>The sketch</h2>
        <p>
          Optional, and worth it: the sketch is where the quantities come from. Wall areas, floor areas, perimeters
          and the disposal weight are all read off the drawing rather than guessed, and every one of them lands in the
          scope. <strong>Create sketch</strong> is on the claim page. At the top of the sketch, <strong>Sketch</strong>,{" "}
          <strong>Moisture</strong> and <strong>Exterior</strong> are three views of the same claim.
        </p>

        <div className="help-figure">
          <Art label="A room drawn by tapping its corners, with a wall length being typed">
            <path d="M24,22 L136,22 L136,82 L24,82 Z" className="help-wall" />
            <circle cx="24" cy="22" r="3.5" className="help-mark" />
            <circle cx="136" cy="22" r="3.5" className="help-mark" />
            <circle cx="136" cy="82" r="3.5" className="help-mark" />
            <circle cx="24" cy="82" r="3.5" className="help-mark" />
            <rect x="58" y="4" width="44" height="14" rx="7" className="help-pill" />
            <path d="M68,11 L92,11" className="help-rule" />
          </Art>
          <div>
            <h3>Drawing a room</h3>
            <p>
              <strong>Add room</strong> drops a rectangle you can drag and resize. <strong>Wall</strong> draws any
              shape a corner at a time — tap each corner and tap the first one again to close it. <strong>Pull room</strong>{" "}
              drags the next room off a wall of this one, so the two share that wall and the door in it.{" "}
              <strong>Break</strong> puts a new corner in a wall so you can pull one half out into an L.
            </p>
            <p>
              <strong>Every length on the plan is a button.</strong> Double-tap a wall or its measurement and type what
              your tape says — the room resizes around it. That is the one number worth correcting; the rest follow.
            </p>
            <p>
              <strong>Double-tap a corner to remove it</strong>, and the two walls either side join back into one. That
              is how a jog you no longer want becomes a flat wall — and it is also what a scan sometimes leaves behind.
              Pushing the jog flat with your finger works too: drive it back into line and it folds away.
            </p>
          </div>
        </div>

        <div className="help-figure">
          <Art label="A door and a window placed on a wall, and a cabinet run against it">
            <path d="M12,60 L58,60 M102,60 L148,60" className="help-wall" />
            <path d="M58,60 q0,-26 44,-26" className="help-rule" />
            <path d="M58,60 L58,34" className="help-rule" />
            <rect x="18" y="66" width="46" height="14" className="help-block" />
            <path d="M104,66 L146,66" className="help-rule" />
            <path d="M104,72 L146,72" className="help-rule" />
          </Art>
          <div>
            <h3>What goes on a wall</h3>
            <p>
              <strong>Door</strong>, <strong>Opening</strong> and <strong>Window</strong> are placed by tapping the wall
              they sit in; press and drag along the wall to draw one at the width you want. A door drawn between two
              rooms is <em>one</em> door — it is deducted from both, and moving it moves it in both.
            </p>
            <p>
              <strong>Cabinet</strong> lays a run against a wall in base, wall or full height. <strong>Island</strong>{" "}
              stands one in open floor. <strong>Fixture…</strong> places a tub, toilet, vanity or shower, and{" "}
              <strong>Add stairs</strong> a flight, which is a room in its own right.
            </p>
          </div>
        </div>

        <h3>Storeys</h3>
        <p>
          A claim that spans floors draws each one on its own storey — <strong>+ Level below</strong> and{" "}
          <strong>+ Level above</strong> — and <strong>Also show</strong> traces another storey underneath the one you
          are drawing, so an upstairs room lands over the room it sits on. Quantities still count the whole building.
        </p>

        <h3>On a phone</h3>
        <p>
          The sketch takes the whole screen on a phone, with the tools on a bar at the bottom: <strong>Select</strong>,{" "}
          <strong>Wall</strong>, <strong>Door</strong> and <strong>More…</strong> for the rest. Tap a room and its
          properties rise from the bottom; tap Close to put them away. Pinch to zoom, drag empty space to pan.
        </p>
      </section>

      <section className="card" id="exterior">
        <h2>The outside of the house</h2>
        <p>
          <strong>Exterior</strong> is the third view of the sketch: the house from outside, for siding, stucco, roofing,
          soffit, fascia and eavestrough. It has a strip across the top: <strong>Plan &amp; roof</strong> first, then
          every side in order round the house. A Scrivn Scan exterior lands here when it is sent from the phone, or
          through <strong>Import scan</strong> on the Sketch view; anything can also be drawn by hand.
        </p>

        <div className="help-figure">
          <Art label="An outline of a house tapped corner by corner, with its roof ridge and a gable end">
            <path d="M20,90 L120,90 L120,52 L84,52 L84,20 L20,20 Z" className="help-wall" />
            <circle cx="20" cy="90" r="3.5" className="help-mark" />
            <circle cx="120" cy="90" r="3.5" className="help-mark" />
            <circle cx="120" cy="52" r="3.5" className="help-mark" />
            <circle cx="84" cy="52" r="3.5" className="help-mark" />
            <circle cx="84" cy="20" r="3.5" className="help-mark" />
            <circle cx="20" cy="20" r="3.5" className="help-mark" />
            <path d="M36,36 L68,36 L68,71 L102,71" className="help-dash" />
            <rect x="128" y="64" width="28" height="14" rx="7" className="help-pill" />
            <path d="M134,71 L150,71" className="help-rule" />
          </Art>
          <div>
            <h3>Drawing the outline</h3>
            <p>An empty exterior offers three ways in:</p>
            <ul className="help-steps">
              <li>
                <strong>Tap the corners</strong> of the house on the plan, going round it, then the first corner again.
                Each wall snaps square to the last on a 1-foot grid, and the street side goes at the bottom. Rough is
                fine: type the real lengths after.
              </li>
              <li>
                <strong>Go round it side by side</strong>: type the front&rsquo;s length, <strong>Start with the front</strong>,
                then add each next side round to the right with its corner (outside, or inside for the inside of an L)
                and its length, as you tape it.
              </li>
              <li>
                <strong>Start from a shape</strong>: Rectangle or L-shape, with its width and depth (and the notch for an
                L).
              </li>
            </ul>
            <p>
              <strong>Eave height, from grade</strong> starts every side at the same height; change any side after. Once
              the outline closes, the roof is there.
            </p>
          </div>
        </div>

        <div className="help-figure">
          <Art label="One side face-on: its gable, a window and a door, with dots to drag">
            <path d="M14,90 L146,90 L146,46 L80,14 L14,46 Z" className="help-wall" />
            <rect x="30" y="54" width="24" height="22" className="help-block" />
            <rect x="104" y="58" width="18" height="32" className="help-block" />
            <path d="M14,82 L146,82" className="help-dash" />
            <circle cx="80" cy="14" r="4" className="help-mark" />
            <circle cx="14" cy="46" r="4" className="help-mark" />
            <circle cx="146" cy="90" r="4" className="help-mark" />
          </Art>
          <div>
            <h3>A side, face-on</h3>
            <p>
              Tap a side&rsquo;s name, on the strip or on the plan, and it opens face-on, to scale, seen from outside. Go
              round the house with <strong>‹ ›</strong>, a swipe across the drawing, or the strip; the small plan beside
              the name shows which side this is, and a tap on it goes back to the plan.
            </p>
            <p>
              <strong>+ Window</strong>, <strong>+ Door</strong> or <strong>+ Garage door</strong>, then a tap on the wall,
              puts one on. Tap an opening to type its width, height, sill and distance from the left corner; drag it to
              move it. Drag a dot to set the eave and the parging (at the left corner), a band between claddings, the gable
              peak, or the length (at the right corner). Every drag also has a typed field below the drawing, with the
              side&rsquo;s cladding bottom up, its openings, and what is on the wall (vents, lights, hose bibs: replace or
              detach &amp; reset).
            </p>
            <p>
              <strong>Lengths:</strong> typing a side&rsquo;s length moves the corner at its right-hand end. Sides that were
              only drawn follow it (they are marked <em>drawn</em>); sides you have taped keep their length, and any gap left
              between two tapes is shared out over them.
            </p>
          </div>
        </div>

        <div className="help-figure">
          <Art label="A roof plan: a hip end, a ridge and a gable end, with a porch roof">
            <path d="M16,24 L144,24 L144,86 L16,86 Z" className="help-wall" />
            <path d="M16,24 L46,55 L144,55 M16,86 L46,55" className="help-rule" />
            <path d="M58,86 L58,100 L102,100 L102,86" className="help-dash" />
            <rect x="120" y="48" width="34" height="14" rx="7" className="help-pill" />
            <rect x="2" y="48" width="30" height="14" rx="7" className="help-pill" />
          </Art>
          <div>
            <h3>The roof plan</h3>
            <p>
              <strong>Plan &amp; roof</strong> draws the roof over the outline, to scale, with the front at the bottom and
              every line labelled with its length. A tap on the plan does what the buttons above it say:
            </p>
            <ul className="help-steps">
              <li>
                <strong>Roof shape</strong>: tap a side&rsquo;s name to open it face-on, or the <strong>Gable</strong> /{" "}
                <strong>Hip</strong> pill at an end of the roof to switch it. <strong>+ Porch roof</strong>,{" "}
                <strong>+ Lean-to porch</strong> or <strong>+ Cross gable</strong>, then a tap on the side it goes on, adds
                one; an L&rsquo;s wing can tie into the main roof or stand lower.
              </li>
              <li>
                <strong>Slopes to roof</strong>: tap a slope to add or leave it out of the roofing.
              </li>
              <li>
                <strong>Eaves &amp; rakes</strong>: which edges take eavestrough (eaves only), soffit and fascia.
              </li>
              <li>
                <strong>Ridge vent</strong>: tap each ridge that has it, or say there is none.
              </li>
            </ul>
            <p>
              <strong>The pitch is assumed at 4/12</strong> until you type it (<strong>Pitch (rise in 12)</strong>, under
              the roof&rsquo;s fields) or a gable&rsquo;s peak is measured on a side. Until then it says{" "}
              <em>assumed</em> on the plan, in the scope (&ldquo;assumed, to confirm&rdquo;) and on the documents, and it
              stays on the <strong>Still to answer</strong> list with every other roof question — material,
              underlayment, drip edge, handload, chimney flashing, vents, leaf guard — none of which is ever taken as a
              no. Overhangs default to 16&Prime; at the eave and 12&Prime; at the rake. Squares are real, with no waste added.
            </p>
            <p className="field-note">
              It is a roof estimate from the footprint and the pitch: nothing is measured from satellite or drone images.
            </p>
          </div>
        </div>

        <h3>Photos and AI trace</h3>
        <p>
          A side photographed in Scrivn Scan shows its photo squared up behind the elevation — <strong>Photo</strong>,{" "}
          <strong>Photo faded</strong> or <strong>No photo</strong>. <strong>AI trace</strong> reads the cladding, the
          windows and doors and the wall top off that photo; tick what you want and press{" "}
          <strong>Put the ticked ones on this side</strong>. It needs signal (with none it waits and runs by itself), and
          the photo comes only from a scan sent from the phone, not from an imported file.
        </p>

        <h3>In the scope, and in 3D</h3>
        <p>
          <strong>In the scope</strong> ticks which exterior work goes into the documents: roofing, each side&rsquo;s
          cladding, soffit &amp; fascia, and eavestrough &amp; downspouts. <strong>Exterior quantities</strong> totals the
          cladding before and after openings, house wrap, trim, corners, roofing and eavestrough. The roof plan and the
          elevations go into the documents as pictures. <strong>3D view</strong> shows the house, siding and roof
          together.
        </p>
      </section>

      <section className="card" id="moisture">
        <h2>The moisture map</h2>
        <div className="help-figure">
          <Art label="A wall reading and a highlighted wet floor inside a room">
            <path d="M24,20 L136,20 L136,86 L24,86 Z" className="help-wall" />
            <rect x="28" y="24" width="60" height="58" className="help-wet" />
            <path d="M24,44 L24,68" className="help-band" />
            <circle cx="24" cy="56" r="4" className="help-mark" />
          </Art>
          <div>
            <p>
              <strong>Moisture</strong> is a view of the sketch, not a second drawing: the rooms stay exactly as you drew
              them. Tap a wall to record a reading there, give it a material, and the band it draws shows how far up the
              wall is affected. <strong>Highlight</strong> paints the wet floor or ceiling with a finger; the square
              footage counts itself. Wet lines, readings and painted areas marked in Scrivn Scan arrive here with the scan.
            </p>
            <p>
              The <strong>dry standard</strong> is the job&rsquo;s, not the room&rsquo;s — one reference reading per
              material for the whole building, which is what tells a wet wall from a normal one. Set it once and every
              wall still sitting on a guess is rewritten.
            </p>
            <p className="field-note">
              Equipment is suggested from what you mapped — air movers and dehumidifiers against the affected area —
              and you can overrule it. What you state is what reaches the documents.
            </p>
          </div>
        </div>
      </section>

      <section className="card" id="drying">
        <h2>The drying log</h2>
        <div className="help-figure">
          <Art label="Readings falling, day by day, to the dry goal">
            <path d="M18,92 L18,14 M18,92 L148,92" className="help-rule" />
            <path d="M18,70 L148,70" className="help-dash" />
            <path d="M28,22 L58,40 L88,58 L118,66 L140,69" className="help-wall" />
            <circle cx="28" cy="22" r="3.5" className="help-mark" />
            <circle cx="58" cy="40" r="3.5" className="help-mark" />
            <circle cx="88" cy="58" r="3.5" className="help-mark" />
            <circle cx="118" cy="66" r="3.5" className="help-mark" />
          </Art>
          <div>
            <p>
              The moisture map is the first visit. The <strong>drying log</strong> is every visit after it, until the
              building is dry. <strong>Drying log</strong> is on the claim page, beside the sketch, and it is optional.
            </p>
            <ul className="help-steps">
              <li>
                <strong>Start Day 1</strong> brings in the moisture map&rsquo;s points and the readings already taken. Add
                any other place you will read each visit.
              </li>
              <li>
                Each visit has its date and time, who read it and the meter; the <strong>Air</strong> outside, in an
                unaffected area and in the affected area (temperature and humidity, worked out to grains per pound); a
                reading at every point; the <strong>Equipment</strong> running; and notes. <strong>+ Visit</strong> adds the
                next one. Day numbers are calendar days.
              </li>
              <li>
                A point is at goal when its reading is within the <strong>dry goal</strong>: the job&rsquo;s dry standard
                plus a margin you set (10% to start). The log is complete when every point is at goal at the latest visit;
                a point with no reading is never counted dry. The strip says where it stands, &ldquo;Day 3 · 5 of 8 points
                at goal&rdquo;.
              </li>
              <li>
                <strong>Summary</strong> lays every visit side by side, and <strong>Download PDF</strong> prints the log on
                your letterhead.
              </li>
            </ul>
            <p>
              <strong>Photo</strong> beside a reading, or beside an air row, reads the number off a photo of the
              meter&rsquo;s screen for you to check. If a digit is unclear it leaves the box empty rather than guess, and it
              warns when the meter&rsquo;s mode doesn&rsquo;t match the visits before. It needs signal; the photo is not
              kept.
            </p>
          </div>
        </div>
      </section>

      <section className="card" id="photos">
        <h2>Photos</h2>
        <div className="help-figure">
          <Art label="A photo with its caption spoken under it, filed to a room">
            <rect x="20" y="14" width="76" height="56" rx="4" className="help-wall" />
            <path d="M28,60 L48,38 L62,52 L72,44 L88,60" className="help-rule" />
            <rect x="106" y="20" width="44" height="14" rx="7" className="help-pill" />
            <path d="M20,82 L140,82 M20,94 L104,94" className="help-rule" />
            <circle cx="148" cy="88" r="4" className="help-mark" />
          </Art>
          <div>
            <p>
              <strong>Photos</strong> on the claim page opens the camera. Pick the room on the chips along the top; its
              name stays large so you notice when you have moved on. Tap the shutter, then say what the photo shows —
              about two seconds of quiet saves it as the caption, and the next photo is ready. Say the room first
              (&ldquo;Kitchen. Sink base is swollen&rdquo;) and the photo is filed there. Tap the words to fix them by
              typing. Gallery adds photos already on the phone, with the time they were taken.
            </p>
            <p>
              The <strong>Photos</strong> panel shows them by room, with <strong>Take photos</strong> and{" "}
              <strong>Add from gallery</strong>. One tap files an unsorted photo to a room. Captioned photos print in the
              Initial Site Report, two to a page with their room, date and time.
            </p>
            <p>
              <strong>Captions feed the scope.</strong> Scrivn reads them with the walkthrough, each with its room and time
              — the pictures themselves are not sent. If you add notes after the scope is read,{" "}
              <strong>Update scope</strong> reads the walkthrough and every photo note again. The follow-up answers you
              have already given are kept wherever the room and item are the same; anything new, or that can&rsquo;t be
              matched for certain, is asked. Then generate the documents again.
            </p>
            <p className="field-note">
              A photo is kept on the device the moment it is taken and uploads on its own, so photos need no signal. The
              spoken caption uses the phone&rsquo;s own speech recognition, which on some phones needs signal: the caption
              box is there to type in.
            </p>
          </div>
        </div>
      </section>

      <section className="card" id="documents">
        <h2>The documents</h2>
        <p>
          The <strong>scope</strong> is organised by phase and room, ready to estimate from. The{" "}
          <strong>inspection report</strong> is the narrative that goes with it, and carries the sketch and the moisture
          map as images when there are any, and the roof plan and elevations when there is an exterior. Both take your
          letterhead from <Link href="/account">Account</Link> — a logo and your company details, set once.
        </p>
        <p>
          Disposal is weighed rather than guessed: every removal in the scope is weighed against your own ladder of
          rates, so the debris line is a number you can defend. A claim with no sketch says so rather than inventing
          one.
        </p>
        <p className="field-note">
          A contents-only claim isn&rsquo;t counted against your plan: its documents are built in Scrivn without the AI
          step.
        </p>
      </section>

      <section className="card" id="phone">
        <h2>The phone</h2>
        <div className="help-figure">
          <Art label="The phone sending a scanned room into a claim">
            <rect x="16" y="26" width="30" height="58" rx="4" className="help-wall" />
            <path d="M24,34 L38,34" className="help-rule" />
            <path d="M54,55 L92,55" className="help-dash" />
            <path d="M84,50 l7,5 l-7,5" className="help-rule" />
            <rect x="102" y="22" width="44" height="66" rx="3" className="help-wall" />
            <path d="M110,38 L138,38 M110,50 L138,50 M110,62 L126,62" className="help-rule" />
          </Art>
          <div>
            <p>
              <strong>Scrivn Scan</strong> measures a room by tapping its corners, and the outside of the house side by
              side, and sends it straight into a claim. It is a separate app on the phone, for Android.
            </p>
            <p>
              <strong>Connecting it.</strong> On the phone, tap <strong>Account</strong> → <strong>Sign in</strong> with
              your Scrivn email and password. Or pair it: on <Link href="/account">Account</Link> here, press{" "}
              <strong>Pair a phone</strong>, then on the phone <strong>Account</strong> →{" "}
              <strong>Pair with a code from Scrivn</strong> and scan the code it shows. Either way the phone stays
              connected until you sign it out, or revoke it from the same page here.
            </p>
            <p>
              <strong>Sending.</strong> Send lists your claims — pick one, or start a new claim, pick the storey, and
              the rooms arrive with their names, their ceilings, their doors and everything on their walls; each level as
              a storey of its own; the moisture marked on the phone; the exterior and its side photos; and the walk&rsquo;s
              360° photos. Scrivn opens at that claim&rsquo;s sketch. With no signal, the phone keeps the scan and sends it
              on its own later.
            </p>
            <p>
              <strong>A scan that arrives while you are working</strong> waits rather than overwriting anything: the
              claim says a scan is here and you choose whether to take it. It only ever replaces the storey it was sent
              to.
            </p>
            <p className="field-note">
              How to capture a room — where to stand, how corners read, ceilings, cabinets, stairs, wet walls, the
              outside — is in the phone app itself: <strong>More… → How to use this app</strong>, and{" "}
              <strong>Walk me through a room</strong> the first time. The <Link href="/scan-guide">Scrivn Scan guide</Link>{" "}
              has all of it in one place.
            </p>
          </div>
        </div>
      </section>

      <section className="card" id="wrong">
        <h2>When something looks wrong</h2>
        <dl className="help-faq">
          <dt>A wall is the wrong length</dt>
          <dd>
            Double-tap it, or its measurement, and type the tape. The room resizes around that wall and the quantities
            follow. Your typed length shows the phone&rsquo;s own reading struck through beside it, so nothing is
            quietly overwritten.
          </dd>

          <dt>A scanned room came in crooked</dt>
          <dd>
            Drag the corner. A corner tapped from very close, or across a mirror or a doorway, can land a foot out; the
            polygon is yours to fix once it is here. If a whole wall is off, typing its length is usually faster than
            dragging both ends.
          </dd>

          <dt>The scope is missing work I described</dt>
          <dd>
            Scrivn scopes work, not damage. &ldquo;Water damage in the ensuite&rdquo; describes a condition;
            &ldquo;remove the vanity and the vinyl in the ensuite&rdquo; describes work. Add the missing sentence to the
            transcript and generate again — it is cheaper than editing the document.
          </dd>

          <dt>The ceiling height says &ldquo;not measured&rdquo;</dt>
          <dd>
            The phone read no ceiling in that room and sent 8&apos; as a default rather than pretending to have
            measured. Type the real height in the room&rsquo;s properties, or tap the ceiling on the phone next time —
            one tap is a height, two are a slope.
          </dd>

          <dt>An island is missing from a scanned kitchen</dt>
          <dd>
            Islands come over as free-standing blocks. If one arrived square to the room when it should sit at an
            angle, drag it round — the angle is the one thing the crossing cannot carry yet.
          </dd>

          <dt>The roof says &ldquo;assumed&rdquo;</dt>
          <dd>
            No pitch was typed and no gable peak measured, so the roof is drawn at 4/12. Type the pitch under the
            roof&rsquo;s fields on <strong>Plan &amp; roof</strong>, or drag a gable&rsquo;s peak on its side, and the
            word goes.
          </dd>

          <dt>A side&rsquo;s photo isn&rsquo;t there</dt>
          <dd>
            Side photos come only with a scan sent from the phone; an exported file brings no photos. Send the exterior
            from Scan to see them.
          </dd>
        </dl>
        <p className="field-note">
          Anything else, <Link href="/contact">get in touch</Link> — and say what you were doing when it happened.
        </p>
      </section>
    </main>
  );
}
