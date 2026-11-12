import { MarketingShell } from "@/components/marketing/MarketingShell";
import { DropASketch } from "@/components/handSketch/DropASketch";
import { handSketchReadAvailable, handSketchReadsOn } from "@/lib/handSketchRead";
import { scopeReadAvailable, scopeReadsOn } from "@/lib/scopeUploadRead";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Drop a sketch or scope (2026-11-12; Drop a sketch since 2026-11-05): photos or a PDF of a hand-drawn sketch, a
 * handwritten scope, or one page with both, back as a scaled plan and a tidied scope. Public: anyone can trace a sketch
 * for free. Reading a page (a sketch or a scope: paid reads) is for signed-in users only, and only while each read's
 * switch is on: lib/handSketchRead.ts and lib/scopeUploadRead.ts decide, and the routes check again.
 */
export const metadata = {
  title: "Drop a Sketch or Scope — Scrivn",
  description: "Photos of your hand-drawn floor sketch or handwritten scope, made into a floor plan to scale and a tidy scope, room by room: PDFs of both.",
};

export default async function DropASketchPage() {
  const dev = process.env.NODE_ENV !== "production";
  let signedIn = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    signedIn = data?.claims != null;
  } else if (dev) {
    // Local, with no Supabase: the dev claims store stands in for an account (lib/devClaimsStore.ts).
    signedIn = true;
  }
  const [canReadSketch, canReadScope] = await Promise.all([handSketchReadAvailable(), scopeReadAvailable()]);
  return (
    <MarketingShell page="drop-a-sketch">
      <div className="mk-pagehead wrap">
        <h1>Drop a sketch or scope</h1>
        <p>Your hand-drawn sketch made into a floor plan at its real size, and your handwritten scope tidied room by room. A gap check is there after, when you want one.</p>
      </div>
      <div className="wrap-narrow">
        <DropASketch signedIn={signedIn} canReadSketch={canReadSketch} canReadScope={canReadScope} sketchReadsOn={handSketchReadsOn()} scopeReadsOn={scopeReadsOn()} dev={dev} />
      </div>
    </MarketingShell>
  );
}
