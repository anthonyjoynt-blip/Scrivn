import Link from "next/link";
import "@/app/marketing.css";

/**
 * Nav, footer and page scope for the public marketing site.
 *
 * Every public page renders `<MarketingShell page="...">`, which supplies the `.mk` class the
 * marketing stylesheet is scoped under. Without that wrapper none of app/marketing.css applies, so
 * a new marketing page must go through here rather than being styled ad hoc.
 *
 * ── The visibility flag ───────────────────────────────────────────────────────────────────────
 * NEXT_PUBLIC_SHOW_MARKETING_NAV controls whether the site presents itself as a storefront. Off
 * (the default), the nav links and the Get Started button are hidden and the home page drops its
 * marketing sections — the pages still exist and are still directly reachable by URL, they just
 * aren't advertised. That's what lets these pages ship and be reviewed at a real URL before the
 * product is ready to be sold to strangers.
 *
 * It's NEXT_PUBLIC_ because the nav renders on pages that are statically generated; a server-only
 * variable would be read at build time anyway. Nothing here is a security control — the flag hides
 * links, it does not restrict access, and the pages are public by design either way.
 */
export type MarketingPage = "home" | "how-it-works" | "pricing" | "faq" | "contact";

export function marketingNavVisible(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_MARKETING_NAV === "true";
}

const NAV_LINKS: { page: MarketingPage; href: string; label: string }[] = [
  { page: "how-it-works", href: "/how-it-works", label: "How It Works" },
  { page: "pricing", href: "/pricing", label: "Pricing" },
  { page: "faq", href: "/faq", label: "FAQ" },
  { page: "contact", href: "/contact", label: "Contact" },
];

export function MarketingShell({ page, children }: { page: MarketingPage; children: React.ReactNode }) {
  const showNav = marketingNavVisible();

  return (
    <div className="mk">
      <nav className="mk-nav">
        <div className="mk-navbar">
          <Link href="/" className="mk-brand">
            {/* ◎ — the mark from the approved mockups. Decorative, so hidden from screen readers. */}
            <span aria-hidden="true">◎</span> Scrivn
          </Link>
          {showNav && (
            <div className="mk-navlinks">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={link.page === page ? "active" : undefined}>
                  {link.label}
                </Link>
              ))}
            </div>
          )}
          {showNav && (
            <Link href="/signup" className="mk-cta-btn">
              Get Started
            </Link>
          )}
        </div>
      </nav>

      {children}

      <footer className="mk-footer">
        <div className="mk-footer-inner">
          <div>© {new Date().getFullYear()} Scrivn</div>
          <div className="mk-footer-links">
            {/*
              Privacy and Terms were in the approved footer but no such pages exist yet, so they are
              not linked — a footer link to a 404 is worse than no link. Add the pages, then add the
              links back here.
            */}
            <Link href="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
