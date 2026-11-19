import { useState } from 'react';
import { AudioLines, Clock, X } from 'lucide-react';
import { ANNOTATE } from '../../config/displayNames';

/**
 * T17700: the two slim rows under the Videos bar that explain Sync BEFORE the tap.
 *
 *  - SecondCameraTip: shown while a second camera covers the playhead, until the
 *    parent dismisses it once on this device.
 *  - PlacedAtEndPrompt: shown while a video we placed at the end plays (no usable
 *    recorded time). "It comes after" hides it for that video on this device (owner
 *    ruling Q2); "Same time" opens the place step (onSameTime).
 *
 * Both flags are per-device dismissed-hint flags (frontend CLAUDE.md localStorage
 * exception): read in a lazy useState initializer, written only by the tap.
 */

const TIP_KEY = 'rb.annotate.syncTipSeen';
const comesAfterKey = (gameId, sequence) => `rb.annotate.comesAfter.${gameId}.${sequence}`;

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Private mode / storage full: the hint simply shows again next time.
  }
}

const rowClass = 'mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm';
const actionClass = 'shrink-0 px-3 py-1.5 coarse-pointer:min-h-11 rounded-lg text-sm font-medium transition-colors';

export function SecondCameraTip() {
  const [seen, setSeen] = useState(() => readFlag(TIP_KEY));
  if (seen) return null;
  const dismiss = () => {
    writeFlag(TIP_KEY);
    setSeen(true);
  };
  return (
    <div data-testid="sync-tip" role="note" className={`${rowClass} border-yellow-800/40 bg-yellow-950/20 text-yellow-100/90`}>
      <AudioLines size={16} className="mt-0.5 shrink-0 text-yellow-300" aria-hidden="true" />
      <p className="flex-1">{ANNOTATE.SYNC_TIP}</p>
      <button
        type="button"
        data-testid="sync-tip-dismiss"
        aria-label={ANNOTATE.SYNC_TIP_DISMISS}
        title={ANNOTATE.SYNC_TIP_DISMISS}
        onClick={dismiss}
        className="shrink-0 p-1 coarse-pointer:min-h-11 coarse-pointer:min-w-11 inline-flex items-center justify-center rounded text-yellow-200/80 hover:text-white hover:bg-yellow-900/40 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function PlacedAtEndPrompt({ gameId, sequence, name, onSameTime }) {
  // Keyed per video by the parent (key={sequence}), so the lazy read is per video.
  const [answered, setAnswered] = useState(() => readFlag(comesAfterKey(gameId, sequence)));
  if (answered) return null;
  const comesAfter = () => {
    writeFlag(comesAfterKey(gameId, sequence));
    setAnswered(true);
  };
  return (
    <div data-testid="placed-at-end-prompt" className={`${rowClass} flex-wrap border-amber-700/40 bg-amber-950/20 text-amber-100/90`}>
      <Clock size={16} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="flex-1 min-w-[200px]">{ANNOTATE.placedAtEndQuestion(name)}</p>
      <div className="flex w-full sm:w-auto justify-between gap-2">
        <button type="button" onClick={comesAfter} className={`${actionClass} text-amber-100 hover:bg-amber-900/40`}>
          {ANNOTATE.PLACED_AT_END_NO}
        </button>
        <button type="button" onClick={() => onSameTime?.(sequence)} className={`${actionClass} bg-gray-700 text-white hover:bg-gray-600`}>
          {ANNOTATE.PLACED_AT_END_YES}
        </button>
      </div>
    </div>
  );
}
