import React from 'react';
import { Lock, X } from 'lucide-react';
import { Button } from '../shared/Button';
import { ratioDisplay, ratioLabel, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { formatDurationHuman } from './format';

/**
 * LockedReasonModal - explains exactly why a collection is locked (T3610/T3630).
 *
 * A collection (smart or game) becomes playable/shareable only once that ratio
 * reaches COLLECTION_MIN_DURATION_SEC of reels. This popup states the threshold,
 * the current amount, and how much more is needed. No backdrop close (project
 * rule); the X / "Got it" button is the only dismiss.
 *
 * @param {string}   name       - collection display name (e.g. "Top Plays", "Vs g1 Jan 22 Highlights")
 * @param {string}   ratio      - '9:16' | '16:9'
 * @param {number}   currentSec - this ratio's duration so far
 * @param {Function} onClose    - REQUIRED
 */
export function LockedReasonModal({ name, ratio, currentSec, onClose }) {
  const cur = currentSec || 0;
  const remaining = Math.max(0, COLLECTION_MIN_DURATION_SEC - cur);
  const pct = Math.max(0, Math.min(100, Math.round((cur / COLLECTION_MIN_DURATION_SEC) * 100)));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      {/* Visual scrim only — no click-to-close (misclicks must not dismiss). */}
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative w-full max-w-sm rounded-xl border border-amber-500/40 bg-gray-800 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-900/30 flex items-center justify-center shrink-0">
              <Lock size={18} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-semibold leading-tight truncate">{name}</h3>
              <p className="text-xs text-gray-400">{ratioDisplay(ratio)} · Locked</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
        </div>

        <p className="text-sm text-gray-300">
          Collections unlock once a ratio has{' '}
          <span className="font-semibold text-amber-300">{formatDurationHuman(COLLECTION_MIN_DURATION_SEC)}</span>{' '}
          of reels.
        </p>

        <div className="my-3">
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-amber-300/80 tabular-nums">
            <span>{formatDurationHuman(cur) || '0s'} so far</span>
            <span>{formatDurationHuman(COLLECTION_MIN_DURATION_SEC)}</span>
          </div>
        </div>

        <p className="text-sm text-gray-300">
          {remaining > 0 ? (
            <>
              Add about{' '}
              <span className="font-semibold text-white">{formatDurationHuman(remaining)}</span>{' '}
              more {ratioLabel(ratio)} content, then you can play and share{' '}
              <span className="font-semibold text-white">{name}</span> as one highlight reel.
            </>
          ) : (
            <>This collection has enough content — reopen My Reels to play it.</>
          )}
        </p>

        <Button variant="primary" size="md" onClick={onClose} className="w-full mt-4">Got it</Button>
      </div>
    </div>
  );
}

export default LockedReasonModal;
