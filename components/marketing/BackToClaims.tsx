"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * "Back to my claims" in the marketing nav (2026-11-10), for someone signed in who came out to Drop a sketch or the
 * drying calculator from Tools in the app's header (components/ToolsMenu.tsx). The wordmark on these pages goes to
 * the home page, and the installed app has no address bar, so without this the only way back was the phone's own back
 * button.
 *
 * Decided in the browser, so the public pages stay static: the Supabase session cookie (`sb-<project>-auth-token`,
 * split as `.0`, `.1` when long) is readable from script, which @supabase/ssr allows by default. It is only a hint for
 * showing a link, never access: a session that has run out still shows it, and /claims then sends that person to
 * sign in, which is where they would have to go anyway.
 */
export function BackToClaims() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(/(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie));
  }, []);

  if (!signedIn) return null;
  return (
    <Link href="/claims" className="mk-back-to-claims">
      Back to my claims
    </Link>
  );
}
