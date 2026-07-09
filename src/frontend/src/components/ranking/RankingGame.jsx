import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Volume2, VolumeX, Trophy, Undo2 } from 'lucide-react';
import { API_BASE } from '../../config';
import { fetchRankConfidence } from '../../utils/rankConfidence';
import { Button } from '../shared/Button';
import { RATIO, RATIO_ORDER, ratioLabel } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { useRankingSettings, useSettingsStore } from '../../stores/settingsStore';
import { useRanking } from '../../hooks/useRanking';
import { useIsMobile } from '../../hooks/useIsMobile';
import { playPop } from '../../utils/rankSound';
import { ReelMatchCard } from './ReelMatchCard';
import { HeroMatchup } from './HeroMatchup';
import { CollectionPlayer } from '../collections/CollectionPlayer';

/** Map a matchup side to a presentational player reel for the full-screen player. */
export function toReplayReel(side) {
  return {
    id: side.id,
    name: side.name,
    streamUrl: `${API_BASE}${side.stream_url}`,
    aspect_ratio: side.aspect_ratio,
    duration: null,
    // T3940: editable project behind the ranked reel, so the replay player can
    // surface "Re-edit". null/0 -> no editable project (button hidden).
    project_id: side.project_id,
  };
}

/**
 * RankingGame - the pairwise "which is better?" game screen (T3630).
 *
 * Video-first: the clip fills as much of the screen as possible with NO black
 * deadspace (full-bleed clip + blurred fill, see ClipVideo). The layout adapts to
 * device x orientation so a clip is never shown in a mismatched player:
 *
 *   Mobile  + portrait  -> HERO + swap  (one clip full-screen, swap to compare)
 *   Mobile  + landscape -> stacked      (both clips, one above the other)
 *   Desktop + portrait  -> side-by-side (both clips, full height)
 *   Desktop + landscape -> stacked      (both clips, one above the other)
 *
 * The big gauge is gone -- ranking progress is a slim bar in the header. Each
 * pick fires POST /api/rank/result (the sole rating write) with a pop + sparkle,
 * then loads the next pair.
 *
 * @param {Function} onClose - REQUIRED. X button only (no backdrop close).
 * @param {Function=} onReEdit - (reel) => void; when set, the replay player shows a
 *   "Re-edit" button. Clicking it closes the ranker first, then navigates (T3940).
 */
export function RankingGame({ onClose, onReEdit }) {
  // Which ratios are eligible to rank. null = still determining.
  const [ratios, setRatios] = useState(null);
  const [ratio, setRatio] = useState(RATIO.PORTRAIT);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const avail = [];
      for (const r of RATIO_ORDER) {
        const d = await fetchRankConfidence(r);
        if (d && d.eligible) avail.push(r);
      }
      if (cancelled) return;
      setRatios(avail);
      if (avail.length) setRatio(avail[0]);
    })();
    return () => { cancelled = true; };
  }, []);

  const ready = ratios !== null;
  const hasPool = ready && ratios.length > 0;
  const { pair, status, confidence, pick, undo, canUndo } = useRanking(ratio, hasPool);

  const rankingSettings = useRankingSettings();
  const soundEnabled = rankingSettings?.rankSoundEnabled ?? true;
  const setRankSoundEnabled = useSettingsStore((s) => s.setRankSoundEnabled);

  const isMobile = useIsMobile();
  const isPortrait = ratio === RATIO.PORTRAIT;
  // Mobile portrait gets the single-clip hero; everything else shows both clips.
  const heroMode = isMobile && isPortrait;
  // Both-shown direction: portrait (desktop) is side-by-side; landscape stacks.
  const splitRow = isPortrait;

  const [wonId, setWonId] = useState(null);
  const [replayReel, setReplayReel] = useState(null);
  const openReplay = useCallback((side) => setReplayReel(toReplayReel(side)), []);

  const handlePick = useCallback((winner, loser) => {
    playPop(soundEnabled);
    setWonId(winner.id);
    setTimeout(() => setWonId(null), 260);
    pick(winner.id, loser.id);
  }, [pick, soundEnabled]);

  // Keyboard voting for the both-shown (split) layouts only. Hero is touch/swap.
  useEffect(() => {
    if (!pair || replayReel || heroMode) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePick(pair.a, pair.b); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handlePick(pair.b, pair.a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pair, replayReel, heroMode, handlePick]);

  // Browser/device Back button -> rematch (undo the last pick) if there is one,
  // otherwise close the game. We keep the SAME URL so the app's editor-mode
  // popstate handler no-ops (it early-returns when targetMode == currentMode).
  const canUndoRef = useRef(canUndo);
  const undoRef = useRef(undo);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    canUndoRef.current = canUndo;
    undoRef.current = undo;
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const url = window.location.pathname + window.location.search + window.location.hash;
    const onPop = () => {
      if (canUndoRef.current) {
        undoRef.current();
        window.history.pushState({ rankGuard: true }, '', url); // re-arm for the next back
      } else {
        onCloseRef.current();
      }
    };
    // Defer the install one microtask so React StrictMode's dev-only
    // mount->cleanup->remount cycle can't churn the history stack. The throwaway
    // first mount is torn down (active=false) before its microtask runs, so it
    // never pushes a trap entry or calls history.back(). Without this, the first
    // cleanup's history.back() fires a popstate that the remounted listener reads
    // as a user Back press and instantly closes the game (dev-only flash-close).
    let active = true;
    let installed = false;
    queueMicrotask(() => {
      if (!active) return;
      window.history.pushState({ rankGuard: true }, '', url);
      window.addEventListener('popstate', onPop);
      installed = true;
    });
    return () => {
      active = false;
      if (!installed) return; // throwaway mount never armed -> nothing to undo
      window.removeEventListener('popstate', onPop);
      // Closed via the X (not Back): drop our leftover same-URL history entry.
      if (window.history.state && window.history.state.rankGuard) window.history.back();
    };
  }, []);

  const pct = confidence?.confidence_pct ?? 0;

  const header = (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-gray-700 flex-0">
      <h2 className="text-white font-bold flex items-center gap-2 shrink-0 text-sm sm:text-base">
        <Trophy size={18} className={REEL.accent} />
        <span className="hidden sm:inline">Which is better?</span>
      </h2>
      {/* Slim Ranking Progress bar (replaces the big gauge in-game). */}
      <div className="flex-1 min-w-0 flex flex-col items-center">
        <div className="w-full max-w-[280px] h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(2, pct)}%`, backgroundColor: pct < 50 ? '#f59e0b' : '#22d3ee' }}
          />
        </div>
        <span className="text-[10px] text-gray-500 mt-0.5 leading-none">Ranking Progress</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/* Rematch: go back to the previous matchup and re-pick (overrides it). */}
        {canUndo && (
          <Button
            variant="ghost"
            size="sm"
            icon={Undo2}
            iconOnly
            title="Rematch -- undo your last pick"
            onClick={undo}
          />
        )}
        {ratios && ratios.length > 1 && (
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {ratios.map((r) => (
              <button
                key={r}
                onClick={() => setRatio(r)}
                className={`px-2.5 min-h-[40px] text-xs transition-colors ${
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
          title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
          onClick={() => setRankSoundEnabled(!soundEnabled)}
        />
        <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
      </div>
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
  } else if (heroMode) {
    body = <HeroMatchup pair={pair} wonId={wonId} muted={!soundEnabled} onPick={handlePick} onReplay={openReplay} />;
  } else {
    body = (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`flex-1 min-h-0 p-2 sm:p-3 flex ${splitRow ? 'flex-row' : 'flex-col'} gap-2 sm:gap-3`}>
          <ReelMatchCard
            className="flex-1 min-h-0 min-w-0"
            side={pair.a}
            hotkeyHint="←"
            won={wonId === pair.a.id}
            onPick={() => handlePick(pair.a, pair.b)}
            onReplay={() => openReplay(pair.a)}
          />
          <div className="flex items-center justify-center shrink-0 text-xs font-bold text-gray-500">VS</div>
          <ReelMatchCard
            className="flex-1 min-h-0 min-w-0"
            side={pair.b}
            hotkeyHint="→"
            won={wonId === pair.b.id}
            onPick={() => handlePick(pair.b, pair.a)}
            onReplay={() => openReplay(pair.b)}
          />
        </div>
        {!isMobile && (
          <p className="text-center text-xs text-gray-500 pb-2">
            Tap a clip to pick it, or use <span className="font-mono text-gray-400">←</span> / <span className="font-mono text-gray-400">→</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-gray-900 flex flex-col">
      {header}
      {body}

      {replayReel && (
        <CollectionPlayer
          reels={[replayReel]}
          title={replayReel.name}
          onClose={() => setReplayReel(null)}
          // Re-editing abandons the ranking session (server-side + resumable, so no
          // confirm): close the ranker first, then restore + navigate (T3940).
          onReEdit={onReEdit ? (reel) => { onClose(); onReEdit(reel); } : undefined}
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
