import React, { useState, useEffect, useCallback } from 'react';
import { X, Volume2, VolumeX, Trophy } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { Button } from '../shared/Button';
import { RATIO, RATIO_ORDER, ratioLabel } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { useRankingSettings, useSettingsStore } from '../../stores/settingsStore';
import { useRanking } from '../../hooks/useRanking';
import { playPop } from '../../utils/rankSound';
import { ReelMatchCard } from './ReelMatchCard';
import { ConfidenceGauge } from './ConfidenceGauge';
import { CollectionPlayer } from '../collections/CollectionPlayer';

/** Map a matchup side to a presentational player reel for tap-to-replay. */
function toReplayReel(side) {
  return {
    id: side.id,
    name: side.name,
    streamUrl: `${API_BASE}${side.stream_url}`,
    aspect_ratio: side.aspect_ratio,
    duration: null,
  };
}

/**
 * RankingGame - the pairwise "which is better?" game screen (T3630).
 *
 * Both ratios are playable on every device (mobile + desktop) via a tab; the tab
 * only offers a ratio that actually has rankable reels, and is hidden entirely
 * when only one ratio qualifies. No skip - every round is a choice. Each pick
 * fires POST /api/rank/result (the sole rating write) with an endorphin cue
 * (sparkle/scale + pop + live meter tick), then loads the next pair.
 *
 * @param {Function} onClose - REQUIRED. X button only (no backdrop close).
 */
export function RankingGame({ onClose }) {
  // Which ratios are eligible to rank (>= 30s of unranked content). null = still
  // determining. The launcher card uses the same gate, so a ratio offered here
  // is one the user could already see was rankable.
  const [ratios, setRatios] = useState(null);
  const [ratio, setRatio] = useState(RATIO.PORTRAIT);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const avail = [];
      for (const r of RATIO_ORDER) {
        try {
          const res = await apiFetch(`${API_BASE}/api/rank/confidence?aspect_ratio=${encodeURIComponent(r)}`);
          if (res.ok) {
            const d = await res.json();
            if (d.eligible) avail.push(r);
          }
        } catch { /* ignore; ratio just won't be offered */ }
      }
      if (cancelled) return;
      setRatios(avail);
      if (avail.length) setRatio(avail[0]);
    })();
    return () => { cancelled = true; };
  }, []);

  const ready = ratios !== null;
  const hasPool = ready && ratios.length > 0;
  const { pair, status, confidence, pick } = useRanking(ratio, hasPool);

  const rankingSettings = useRankingSettings();
  const soundEnabled = rankingSettings?.rankSoundEnabled ?? true;
  const setRankSoundEnabled = useSettingsStore((s) => s.setRankSoundEnabled);

  const [wonId, setWonId] = useState(null);
  const [replayReel, setReplayReel] = useState(null);

  const handlePick = useCallback((winner, loser) => {
    playPop(soundEnabled);
    setWonId(winner.id);
    setTimeout(() => setWonId(null), 260);
    pick(winner.id, loser.id);
  }, [pick, soundEnabled]);

  // Desktop keyboard voting: left/right arrow picks the left/right card. Ignored
  // while the full replay player is open or there's no live pair.
  useEffect(() => {
    if (!pair || replayReel) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePick(pair.a, pair.b); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handlePick(pair.b, pair.a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pair, replayReel, handlePick]);

  const pct = confidence?.confidence_pct ?? 0;

  const header = (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-700">
      <h2 className="text-white font-bold flex items-center gap-2">
        <Trophy size={18} className={REEL.accent} />
        Which is better?
      </h2>
      <div className="flex items-center gap-2">
        {/* Ratio tab: only ratios with reels, hidden when a single ratio qualifies. */}
        {ratios && ratios.length > 1 && (
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {ratios.map((r) => (
              <button
                key={r}
                onClick={() => setRatio(r)}
                className={`px-3 min-h-[44px] text-sm transition-colors ${
                  r === ratio ? `${REEL.bg} text-white` : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {ratioLabel(r)}
              </button>
            ))}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={soundEnabled ? Volume2 : VolumeX}
          iconOnly
          title={soundEnabled ? 'Mute pick sound' : 'Unmute pick sound'}
          onClick={() => setRankSoundEnabled(!soundEnabled)}
        />
        <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
      </div>
    </div>
  );

  // Live confidence meter (fuel gauge; the needle ticks up on every pick). On
  // desktop it grows to fill the empty band above the matchup (capped so it
  // stays tasteful); the narrow/mobile panel keeps its compact size so nothing
  // else shifts.
  const meter = (
    <div className="flex flex-col items-center justify-center gap-1 px-4 pt-2 pb-1 md:flex-1 md:min-h-0">
      <div className="flex w-full items-center justify-center md:flex-1 md:min-h-0 md:py-3">
        <ConfidenceGauge pct={pct} fill className="h-[78px] w-auto md:h-full md:max-h-[440px]" />
      </div>
      <span className="text-xs text-gray-400">Collection Confidence</span>
    </div>
  );

  const caughtUp = (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
      <Trophy size={40} className={REEL.accent} />
      <p className="text-white font-semibold">You're caught up for now.</p>
      <p className="text-sm text-gray-400">
        New clips will ask for a few matchups when you publish them.
      </p>
      <Button variant="primary" size="md" onClick={onClose} className="mt-2">Done</Button>
    </div>
  );

  let body;
  if (!ready || (hasPool && status === 'loading')) {
    body = <div className="flex-1 flex items-center justify-center text-gray-400">Loading matchup…</div>;
  } else if (!hasPool || status === 'exhausted' || !pair) {
    body = caughtUp;
  } else {
    body = (
      <div className="flex-1 md:flex-none overflow-y-auto px-4 pb-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-5xl mx-auto flex flex-col gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-stretch md:gap-4">
          <ReelMatchCard
            side={pair.a}
            hotkeyHint="←"
            won={wonId === pair.a.id}
            onPick={() => handlePick(pair.a, pair.b)}
            onReplay={() => setReplayReel(toReplayReel(pair.a))}
          />
          <div className="flex items-center justify-center font-bold text-gray-500 md:flex-col">
            VS
          </div>
          <ReelMatchCard
            side={pair.b}
            hotkeyHint="→"
            won={wonId === pair.b.id}
            onPick={() => handlePick(pair.b, pair.a)}
            onReplay={() => setReplayReel(toReplayReel(pair.b))}
          />
        </div>
        <p className="hidden md:block mt-4 text-xs text-gray-500">
          Tap a clip to pick it, or use <span className="font-mono text-gray-400">←</span> / <span className="font-mono text-gray-400">→</span>
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-gray-900 flex flex-col">
      {header}
      {meter}
      {body}

      {replayReel && (
        <CollectionPlayer
          reels={[replayReel]}
          title={replayReel.name}
          onClose={() => setReplayReel(null)}
        />
      )}

      <style>{`
        @keyframes reelSparkle {
          0% { opacity: 0; transform: scale(0.4); }
          40% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.5); }
        }
        .reel-sparkle { animation: reelSparkle 0.4s ease-out forwards; }
        .reel-match-won { box-shadow: 0 0 0 2px rgba(34,211,238,0.6); }
      `}</style>
    </div>
  );
}

export default RankingGame;
