import type { Letterhead, RGB } from "@/lib/letterhead";
import { DEFAULT_LETTERHEAD, LOGO_BOX, fitLogo, letterheadTextColor } from "@/lib/letterhead";

function rgb([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The same letterhead `lib/pdf.ts`'s `drawLetterhead` draws into the downloaded PDF, rendered as
 * HTML for the on-screen preview — and for the live preview on the account page while an owner is
 * choosing colours. Reads the same `Letterhead` object, so the preview and the PDF cannot drift.
 *
 * The logo is fitted into the same box the PDF uses, in px for pt, so what the PM sees on screen
 * is the proportion the printed page will have.
 */
export function LetterheadBanner({ letterhead = DEFAULT_LETTERHEAD }: { letterhead?: Letterhead }) {
  const logo = letterhead.logo ? fitLogo(letterhead.logo.width, letterhead.logo.height, LOGO_BOX) : null;
  return (
    <div className="letterhead-banner" style={{ background: rgb(letterhead.primaryColor), color: rgb(letterheadTextColor(letterhead.primaryColor)) }}>
      {letterhead.logo && logo && logo.width > 0 && (
        // A plain <img>: the source is a data URL already at the size it is drawn, so there is
        // nothing for next/image to optimise and no URL for it to optimise from.
        <img className="letterhead-banner-logo" src={letterhead.logo.dataUrl} alt="" width={Math.round(logo.width)} height={Math.round(logo.height)} />
      )}
      <div className="letterhead-banner-text">
        <div className="letterhead-banner-name">{letterhead.companyName}</div>
        {letterhead.tagline && <div className="letterhead-banner-tagline">{letterhead.tagline}</div>}
      </div>
      <div className="letterhead-banner-accent" style={{ background: rgb(letterhead.accentColor) }} />
    </div>
  );
}
