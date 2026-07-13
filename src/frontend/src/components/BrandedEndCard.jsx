import { LogoWithText } from './Logo';
import { BRANDED_OUTRO_ENABLED } from '../constants/brandedOutro';

const CTA_URL =
  'https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

export function BrandedEndCard({
  visible,
  onReplay,
  // Default anchors inside a relative player container (SharedVideoOverlay).
  // Fullscreen fixed players (CollectionPlayer, z-[70]) must pass a fixed,
  // higher-z override or the card renders underneath them.
  positionClassName = 'absolute inset-0 z-20',
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
          widthClassName="w-[150px]"
        />
      </div>

      {/* Bottom: bare-text CTA, no shape */}
      <a
        href={CTA_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full text-center font-semibold text-lg pb-8 pt-5 px-6 hover:underline"
        style={{ color: '#c084fc', textDecoration: 'none' }}
      >
        Make your own reel at www.reelballers.com
      </a>
    </div>
  );
}
