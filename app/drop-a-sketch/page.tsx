import { MarketingShell } from "@/components/marketing/MarketingShell";
import { DropASketch } from "@/components/handSketch/DropASketch";
import { handSketchReadAvailable } from "@/lib/handSketchRead";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Drop a sketch (2026-11-05): a photo of a hand-drawn floor sketch made into a Scrivn sketch at its real size. Public:
 * anyone can trace one for free. "Read it for me" (a paid read) is for signed-in users only, and only when
 * SCRIVN_HAND_SKETCH_READS is on — lib/handSketchRead.ts decides, and the route checks again.
 */
export const metadata = {
  title: "Drop a Sketch — Scrivn",
  description: "A photo of your hand-drawn floor sketch, made into a scaled floor plan: to-scale PDF and JPG, every room's size.",
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
  const canRead = await handSketchReadAvailable();
  return (
    <MarketingShell page="drop-a-sketch">
      <div className="mk-pagehead wrap">
        <h1>Drop a sketch</h1>
        <p>A photo of your hand-drawn sketch, made into a floor plan at its real size: the numbers you wrote set the sizes.</p>
      </div>
      <div className="wrap-narrow">
        <DropASketch signedIn={signedIn} canRead={canRead} dev={dev} />
      </div>
    </MarketingShell>
  );
}
