import type { Letterhead } from "@/lib/letterhead";
import { DEFAULT_LETTERHEAD } from "@/lib/letterhead";

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The same letterhead branding `lib/pdf.ts`'s `drawLetterhead` draws into the downloaded PDF,
 * rendered as HTML for the on-screen preview — previously the preview showed no branding at all,
 * only the PDF did. Reads the same `Letterhead` shape, so swapping brands later (see that file's
 * doc comment) stays a one-object change instead of touching the preview and the PDF separately.
 */
export function LetterheadBanner({ letterhead = DEFAULT_LETTERHEAD }: { letterhead?: Letterhead }) {
  return (
    <div className="letterhead-banner" style={{ background: rgb(letterhead.primaryColor) }}>
      <div className="letterhead-banner-name">{letterhead.companyName}</div>
      <div className="letterhead-banner-tagline">{letterhead.tagline}</div>
      <div className="letterhead-banner-accent" style={{ background: rgb(letterhead.accentColor) }} />
    </div>
  );
}
