import Link from "next/link";

/**
 * How to use Scrivn, for reading at the desk.
 *
 * Deliberately NOT a copy of the phone's how-to. Scrivn Scan carries its own guide — every chip's
 * paragraph, with a drawing, in `More… → How to use this app` — written for somebody holding the
 * phone in a room, and the phone is the only place that text lives. Two copies of "how to tap a
 * corner" would be two things to keep true, and the one on the website is always the stale one.
 *
 * So this page teaches SCRIVN — the claim, the sketch, the moisture map, the documents — and says
 * only enough about the phone to know what it is for and how to pair it. Where the phone's own
 * guide is the answer, it says so.
 *
 * Static: no claim data, nothing fetched. It renders inside the signed-in shell because that is
 * where somebody reading it already is, and it is linked from the footer of every page in the tool.
 */
export const metadata = {
  title: "Help — Scrivn",
  description: "How a claim moves through Scrivn, how the sketch and moisture map work, and how the phone fits in.",
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
  { id: "moisture", title: "The moisture map" },
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
          on it, <strong>More… → How to use this app</strong>.
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
        <p className="field-note">
          A claim is saved to your organisation, not to a device. Start one on a laptop and finish it on a phone.
        </p>
      </section>

      <section className="card" id="sketch">
        <h2>The sketch</h2>
        <p>
          Optional, and worth it: the sketch is where the quantities come from. Wall areas, floor areas, perimeters
          and the disposal weight are all read off the drawing rather than guessed, and every one of them lands in the
          scope. <strong>Create sketch</strong> is on the claim page.
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
              <strong>Moisture</strong> is a tab on the sketch, not a second drawing: the rooms stay exactly as you drew
              them. Tap a wall to record a reading there, give it a material, and the band it draws shows how far up the
              wall is affected. <strong>Highlight</strong> paints the wet floor or ceiling with a finger; the square
              footage counts itself.
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

      <section className="card" id="documents">
        <h2>The documents</h2>
        <p>
          The <strong>scope</strong> is organised by phase and room, ready to estimate from. The{" "}
          <strong>inspection report</strong> is the narrative that goes with it, and carries the sketch and the moisture
          map as images when there are any. Both take your letterhead from <Link href="/account">Account</Link> — a logo
          and your company details, set once.
        </p>
        <p>
          Disposal is weighed rather than guessed: every removal in the scope is weighed against your own ladder of
          rates, so the debris line is a number you can defend. A claim with no sketch says so rather than inventing
          one.
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
              <strong>Scrivn Scan</strong> measures a room by tapping its corners and sends it straight into a claim as
              a sketch. It is a separate app on the phone.
            </p>
            <p>
              <strong>Pairing.</strong> On <Link href="/account">Account</Link>, add a phone and scan the QR code it
              shows with Scrivn Scan (long-press <strong>Send</strong> on the capture screen). One scan, once; the phone
              stays paired until you revoke it from the same page.
            </p>
            <p>
              <strong>Sending.</strong> Send lists your claims — pick one, or start a new claim, pick the storey, and
              the rooms arrive with their names, their ceilings and everything on their walls. Scrivn opens at that
              claim&rsquo;s sketch.
            </p>
            <p>
              <strong>A scan that arrives while you are working</strong> waits rather than overwriting anything: the
              claim says a scan is here and you choose whether to take it. It only ever replaces the storey it was sent
              to.
            </p>
            <p className="field-note">
              How to capture a room — where to stand, how corners read, ceilings, cabinets, stairs — is in the phone
              app itself: <strong>More… → How to use this app</strong>, and <strong>Walk me through a room</strong> the
              first time.
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
        </dl>
        <p className="field-note">
          Anything else, <Link href="/contact">get in touch</Link> — and say what you were doing when it happened.
        </p>
      </section>
    </main>
  );
}
