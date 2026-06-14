import React, { useState, useEffect, useCallback } from 'react';
import { X, Volume2, VolumeX, Trophy } from 'lucide-react';
import { API_BASE } from '../../config';
import { Button } from '../shared/Button';
import { RATIO, RATIO_ORDER, ratioLabel } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { useRankingSettings, useSettingsStore } from '../../stores/settingsStore';
import { useRanking } from '../../hooks/useRanking';
import { playPop } from '../../utils/rankSound';
import { ReelMatchCard } from './ReelMatchCard';
import { CollectionPlayer } from '../collections/CollectionPlayer';

const DESKTOP_QUERY = '(min-width: 768px)';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

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
 * Device rule (decision #4): phone = Portrait pool only; desktop = Portrait OR
 * Landscape via a tab. No skip — every round is a choice (decision #5). Each pick
 * fires POST /api/rank/result (the sole rating write) with an endorphin cue
 * (sparkle/scale + pop + live meter tick), then loads the next pair.
 *
 * @param {Function} onClose - REQUIRED. X button only (no backdrop close).
 */
export function RankingGame({ onClose }) {
  const isDesktop = useIsDesktop();
  // Phone is portrait-locked; desktop may toggle.
  const [ratio, setRatio] = useState(RATIO.PORTRAIT);
  useEffect(() => { if (!isDesktop) setRatio(RATIO.PORTRAIT); }, [isDesktop]);

  const { pair, status, confidence, pick } = useRanking(ratio);

  const rankingSettings = useRankingSettings();
  const soundEnabled = rankingSettings?.rankSoundEnabled ?? true;
  const setRankSoundEnabled = useSettingsStore((s) => s.setRankSoundEnabled);

  const [wonId, setWonId] = useState(null);
  const [replayReel, setReplayReel] = useState(null);

  const handlePick = useCallback((winner, loser) => {
    playPop(soundEnabled);
    setWonId(winner.id);
    // Let the sparkle/scale play briefly, then advance.
    setTimeout(() => setWonId(null), 260);
    pick(winner.id, loser.id);
  }, [pick, soundEnabled]);

  const pct = confidence?.confidence_pct ?? 0;

  const header = (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-700">
      <h2 className="text-white font-bold flex items-center gap-2">
        <Trophy size={18} className={REEL.accent} />
        Which is better?
      </h2>
      <div className="flex items-center gap-2">
        {isDesktop && (
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {RATIO_ORDER.map((r) => (
              <button
                key={r}
                onClick={() => setRatio(r)}
                className={`px-3 min-h-[36px] text-sm transition-colors ${
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

  // Live confidence meter.
  const meter = (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
        <span>Collection Confidence</span>
        <span className={`font-semibold ${REEL.accent}`}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
        <div
          className={`h-full ${REEL.bg} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );

  let body;
  if (status === 'loading') {
    body = <div className="flex-1 flex items-center justify-center text-gray-400">Loading matchup…</div>;
  } else if (status === 'exhausted' || !pair) {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
        <Trophy size={40} className={REEL.accent} />
        <p className="text-white font-semibold">You're caught up for now.</p>
        <p className="text-sm text-gray-400">
          New clips will ask for a few matchups when you publish them.
        </p>
        <Button variant="primary" size="md" onClick={onClose} className="mt-2">Done</Button>
      </div>
    );
  } else {
    const cards = (
      <>
        <ReelMatchCard
          side={pair.a}
          pickLabel="Pick A"
          won={wonId === pair.a.id}
          onPick={() => handlePick(pair.a, pair.b)}
          onReplay={() => setReplayReel(toReplayReel(pair.a))}
        />
        <div className="flex items-center justify-center font-bold text-gray-500 md:flex-col">
          VS
        </div>
        <ReelMatchCard
          side={pair.b}
          pickLabel="Pick B"
          won={wonId === pair.b.id}
          onPick={() => handlePick(pair.b, pair.a)}
          onReplay={() => setReplayReel(toReplayReel(pair.b))}
        />
      </>
    );
    body = (
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
          {cards}
        </div>
        <p className="text-center text-xs text-gray-500 mt-3">no skip — always choose</p>
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
