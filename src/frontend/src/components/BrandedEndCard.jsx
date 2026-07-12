import React from 'react';
import { BRANDED_OUTRO_ENABLED } from '../constants/brandedOutro';

/**
 * BrandedEndCard — "Made with Reel Ballers" end-card shown on PUBLIC/SHARED
 * playback surfaces after all video content ends. T3950 (playback compositing).
 *
 * Prop-gated: only rendered where the `visible` prop is ever set to true.
 * SharedVideoOverlay and SharedCollectionView set it; the in-app editor,
 * ranker, and the owner's My Reels player never pass it.
 *
 * @param {boolean}  visible   - show the card
 * @param {Function} onReplay  - called when the Replay button is clicked
 */
export function BrandedEndCard({ visible, onReplay }) {
  if (!BRANDED_OUTRO_ENABLED || !visible) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center"
      style={{ background: 'rgba(11,15,26,0.97)' }}
    >
      <p
        className="text-white font-bold text-center px-4"
        style={{ fontSize: 'clamp(18px,4vw,28px)' }}
      >
        Made with Reel Ballers
      </p>
      <p
        className="text-gray-400 mt-2"
        style={{ fontSize: 'clamp(12px,2.5vw,16px)' }}
      >
        reelballers.com
      </p>
      <button
        onClick={onReplay}
        className="mt-6 px-6 py-2 rounded-full bg-cyan-400 text-gray-900 font-semibold text-sm hover:bg-cyan-300 transition-colors"
      >
        Replay
      </button>
    </div>
  );
}
