import React from 'react';
import { Trophy, ArrowLeftRight } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';

/**
 * HeroIntroModal - first-time explainer for the mobile hero matchup (T3630).
 *
 * Hero mode shows ONE clip at a time, which isn't obvious, so we name both
 * contestants and explain how to switch before the user can pick the wrong one.
 * Shown once per hero session (no backdrop close -- "Got it" only).
 *
 * @param {object}   a       - first clip side ({ name, ... })
 * @param {object}   b       - second clip side
 * @param {Function} onClose - REQUIRED
 */
export function HeroIntroModal({ a, b, onClose }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-sm rounded-xl border border-cyan-500/40 bg-gray-800 p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={20} className={REEL.accent} />
          <h3 className="text-white font-semibold">Which is better?</h3>
        </div>

        <p className="text-sm text-gray-300">
          You're choosing between{' '}
          <span className="font-semibold text-white">{a.name}</span> and{' '}
          <span className="font-semibold text-white">{b.name}</span>.
        </p>

        <p className="mt-3 text-sm text-gray-300 flex items-start gap-2">
          <ArrowLeftRight size={16} className={`${REEL.accent} mt-0.5 shrink-0`} />
          <span>
            Only one plays at a time. <span className="font-semibold text-white">Swipe</span> across the
            video (or tap the small thumbnail / the dots) to switch between them, then tap{' '}
            <span className="font-semibold text-white">Pick</span> on the better one.
          </span>
        </p>

        <Button variant="primary" size="md" onClick={onClose} className="w-full mt-4">Got it</Button>
      </div>
    </div>
  );
}

export default HeroIntroModal;
