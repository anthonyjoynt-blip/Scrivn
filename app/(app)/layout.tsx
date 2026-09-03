import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import { UsageBanner } from "@/components/UsageBanner";

/**
 * Chrome for the signed-in application: the wordmark header and the usage banner.
 *
 * `(app)` is a route group, so it contributes nothing to any URL — /claim, /account, /login and the
 * rest keep the paths they always had. Its only job is to draw a line between the pages that are
 * "the product" and the public marketing pages at /, /how-it-works, /faq, /pricing and /contact,
 * which live outside it and render their own nav and footer instead.
 *
 * The auth pages (login, signup, password reset) sit inside this group on purpose: they're part of
 * the product, and UserMenu renders nothing when signed out, so the header correctly degrades to
 * just the wordmark.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          {/* The wordmark points at the claim tool, not at /, which is now the marketing home —
              a signed-in user clicking the logo wants their work, not the shop window. */}
          <Link href="/claim" className="wordmark">
            Scrivn
          </Link>
          {/* Renders nothing when signed out — see components/UserMenu.tsx. */}
          <UserMenu />
        </div>
      </header>
      {/* Renders only at 80%+ of the plan limit — see components/UsageBanner.tsx. */}
      <UsageBanner />
      {children}
    </>
  );
}
