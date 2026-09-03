import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * T8330 — account-level, dismissible banner that gives a user an affirmative,
 * proactive signal when source games their Reel Drafts depend on are about to
 * be deleted (inside the warning window) or are already in the rescuable grace
 * window. This is the data-loss case bug 50p exposed: a drafts-only user could
 * pass through the entire expiry + grace window without one signal.
 *
 * Presentational only — the parent computes the counts at render time from data
 * already loaded (computeStorageExpiryRisk) and owns the dismiss + deep-link
 * gestures. No fetch, no store write, no persisted "seen" state (dismissal is
 * session-only, cleared on reload). Renders nothing when no game is at risk.
 */
export function StorageExpiryBanner({ atRiskGameCount, dependentDraftCount, onExtend, onDismiss }) {
  if (!atRiskGameCount) return null;

  const gameWord = atRiskGameCount === 1 ? 'game' : 'games';
  const gamePronoun = atRiskGameCount === 1 ? 'it' : 'them';
  const reelWord = dependentDraftCount === 1 ? 'draft reel' : 'draft reels';
  const dependVerb = dependentDraftCount === 1 ? 'depends' : 'depend';

  return (
    <div
      role="alert"
      data-testid="storage-expiry-banner"
      className="w-full max-w-2xl mb-4 flex items-start gap-2 rounded-lg border border-yellow-800/50 bg-yellow-900/30 px-3 py-2.5 text-sm text-yellow-200"
    >
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-yellow-400" />
      <div className="flex-1 min-w-0">
        <span>
          {atRiskGameCount} {gameWord} expiring soon — {dependentDraftCount} {reelWord}{' '}
          {dependVerb} on {gamePronoun}.
        </span>{' '}
        <button
          type="button"
          onClick={onExtend}
          className="font-semibold text-yellow-100 underline underline-offset-2 hover:text-white"
        >
          Extend storage
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-yellow-400/70 hover:text-yellow-200"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default StorageExpiryBanner;
