import Link from "next/link";

/**
 * The free tools on the home page (2026-11-06): pages anyone can use now, with no account, while Scrivn itself is
 * still coming soon. Shown whether or not the marketing nav is on (the nav is off while the site is a landing page,
 * and these are the parts of it a stranger can use today), and in the footer of every marketing page.
 */
export const FREE_TOOLS: { href: string; label: string; icon: string; title: string; text: string; cta: string }[] = [
  {
    href: "/drop-a-sketch",
    label: "Drop a sketch",
    icon: "✏️",
    title: "Your hand sketch, to scale",
    text: "Photograph a floor sketch you drew on site. Scrivn finds the rooms and doors, you add the sizes you wrote, and it draws the plan to scale, ready as a PDF or a picture.",
    cta: "Drop in a sketch",
  },
  {
    href: "/drying-calculator",
    label: "Drying calculator",
    icon: "💧",
    title: "Drying equipment calculator",
    text: "Air movers and dehumidifiers for a water loss, room by room, from IICRC S500 guidance, with a suggested layout.",
    cta: "Open the calculator",
  },
];

export function FreeTools() {
  return (
    <div className="mk-tools wrap">
      <h2>Free to use now, no account needed</h2>
      <div className="mk-tools-grid">
        {FREE_TOOLS.map((t) => (
          <div className="mk-tool-card" key={t.href}>
            <div className="mk-benefit-icon" aria-hidden="true">
              {t.icon}
            </div>
            <h3>{t.title}</h3>
            <p>{t.text}</p>
            <Link href={t.href} className="mk-btn-primary">
              {t.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
