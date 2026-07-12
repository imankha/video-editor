import React from 'react';
import { LogoWithText } from './Logo';
import { BRANDED_OUTRO_ENABLED } from '../constants/brandedOutro';

const CTA_URL =
  'https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

export function BrandedEndCard({ visible, onReplay }) {
  if (!BRANDED_OUTRO_ENABLED || !visible) return null;
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 px-5"
      style={{ background: 'rgba(11,15,26,0.97)' }}
    >
      <a
        href={CTA_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full max-w-xs text-center py-4 rounded-full font-bold text-white text-lg hover:opacity-90 transition-opacity"
        style={{ background: '#a855f7', display: 'block', textDecoration: 'none' }}
      >
        Make your own reel at www.reelballers.com
      </a>

      <div className="flex flex-col items-center gap-2">
        <span className="text-gray-400 text-sm">Made With</span>
        <LogoWithText onLogoClick={onReplay} logoAriaLabel="Replay" />
      </div>
    </div>
  );
}
