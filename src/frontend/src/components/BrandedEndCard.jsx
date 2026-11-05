import { LogoWithText } from './Logo';
import { BRANDED_OUTRO_ENABLED } from '../constants/brandedOutro';

const CTA_BASE = 'https://www.reelballers.com/';
const CTA_UTM = 'utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

// T15070: the CTA carries the sharer's invite code (+ sport snapshot) so a
// sign-up through it is attributable to the parent who shared. First touch wins
// in captureCampaignParams: a viewer who opens two sharers' highlights in one
// tab is attributed to the first. No code -> the plain campaign URL.
export function ctaUrl(refCode, sport) {
  const q = [];
  if (refCode) q.push(`ref=${encodeURIComponent(refCode)}`);
  if (refCode && sport) q.push(`sport=${encodeURIComponent(sport)}`);
  q.push(CTA_UTM);
  return `${CTA_BASE}?${q.join('&')}`;
}

export function BrandedEndCard({
  visible,
  onReplay,
  // Default anchors inside a relative player container (SharedVideoOverlay).
  // Fullscreen fixed players (CollectionPlayer, z-[70]) must pass a fixed,
  // higher-z override or the card renders underneath them.
  positionClassName = 'absolute inset-0 z-20',
  refCode,
  sport,
}) {
  if (!BRANDED_OUTRO_ENABLED || !visible) return null;
  return (
    <div
      className={`${positionClassName} flex flex-col items-center px-5`}
      style={{ background: 'rgba(11,15,26,0.97)' }}
    >
      {/* Hero: the logo lockup, centered; the emblem replays */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <span className="text-gray-400 text-sm">Made With</span>
        <LogoWithText
          onLogoClick={onReplay}
          logoAriaLabel="Replay"
          logoSize={112}
          textClassName="text-3xl"
        />
      </div>

      {/* Bottom: bare-text CTA, no shape */}
      <BrandedCtaLink className="w-full pb-8 pt-5 px-6" refCode={refCode} sport={sport} />
    </div>
  );
}

/** The tracked "make your own" link. Shared by the end card and the persistent
 *  share-page placements (teammate-tag, game-link) so copy + UTM stay identical. */
export function BrandedCtaLink({ className = '', refCode, sport }) {
  return (
    <a
      href={ctaUrl(refCode, sport)}
      target="_blank"
      rel="noopener noreferrer"
      className={`block text-center font-semibold text-lg hover:underline ${className}`}
      style={{ color: '#c084fc', textDecoration: 'none' }}
    >
      Make your own highlights at www.reelballers.com
    </a>
  );
}
