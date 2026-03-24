import { useState, useEffect, useRef, useCallback } from 'react';
import { ListChecks, Check, Gem, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { QUESTS } from '../config/questDefinitions';
import { toast } from './shared/Toast';

import exportWebSocketManager from '../services/ExportWebSocketManager';

/**
 * QuestPanel — self-contained floating overlay with collapsed/expanded states (T540).
 *
 * Collapsed: icon + quest title + progress (e.g., "Get Started  2/5")
 * Expanded: full step checklist + reward
 *
 * No header button needed — this component handles its own visibility,
 * fetching, and event subscriptions.
 */
export function QuestPanel() {
  const quests = useQuestStore((s) => s.quests);
  const loaded = useQuestStore((s) => s.loaded);
  const activeQuestId = useQuestStore((s) => s.activeQuestId);
  const fetchProgress = useQuestStore((s) => s.fetchProgress);

  const claimReward = useQuestStore((s) => s.claimReward);

  const [expanded, setExpanded] = useState(true);  // Start expanded for new users
  const [hidden, setHidden] = useState(false);       // User fully dismissed
  const [claiming, setClaiming] = useState(false);
  const [celebrating, setCelebrating] = useState(false);  // Quest complete celebration
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const prevCompletedRef = useRef(null);  // Track step count to detect new completions
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ left: null, bottom: null });

  // Simple positioning: bottom-left with sidebar awareness
  const updatePosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const isSm = window.innerWidth >= 640;
    const defaultLeft = isSm ? 24 : 12;
    const defaultBottom = isSm ? 40 : 12;

    setPosition({ left: defaultLeft, bottom: defaultBottom });
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    const observer = new MutationObserver(updatePosition);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePosition);
      observer.disconnect();
    };
  }, [updatePosition, expanded]);

  // Play sound effects
  const playSound = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'check') {
        // Quick bright ping for step completion
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'fanfare') {
        // Celebratory ascending arpeggio for quest completion
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        osc.frequency.setValueAtTime(523, ctx.currentTime);         // C5
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.12);  // E5
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.24);  // G5
        osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.36); // C6
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch {
      // Audio not available — no-op
    }
  };

  // T635: Quest progress is fetched centrally in App.jsx after auth resolves.
  // No need to fetch on mount here — the store is already populated.

  // Subscribe to export events to refresh quest progress
  useEffect(() => {
    const unsub = exportWebSocketManager.addEventListener('*', 'complete', fetchProgress);
    return () => { unsub(); };
  }, [fetchProgress]);

  // Detect step completions and quest completions for audio/animation
  const questDef = QUESTS.find(q => q.id === activeQuestId) || QUESTS[0];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const currentCompleted = questProgress
    ? Object.values(questProgress.steps).filter(Boolean).length
    : 0;

  useEffect(() => {
    if (prevCompletedRef.current === null) {
      // First load — just record, don't play sound
      prevCompletedRef.current = currentCompleted;
      return;
    }
    if (currentCompleted > prevCompletedRef.current) {
      const questStepCount = questDef.steps.length;
      if (currentCompleted === questStepCount && !questProgress?.reward_claimed) {
        // All steps done — fanfare + celebration animation
        playSound('fanfare');
        setCelebrating(true);
        setExpanded(true);
      } else {
        // Individual step completed
        playSound('check');
      }
    }
    prevCompletedRef.current = currentCompleted;
  }, [currentCompleted]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if hidden, not loaded, or all quests fully done (unless modal is showing)
  const allQuestsDone = loaded && quests.length > 0 && quests.every(q => q.reward_claimed);
  if ((hidden || !loaded || allQuestsDone) && !showCompletionModal) return null;
  const steps = questProgress?.steps || {};
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = questDef.steps.length;
  const isComplete = completedCount === totalCount;
  const progressPercent = (completedCount / totalCount) * 100;
  const currentStepId = questDef.steps.find(s => !steps[s.id])?.id;

  const handleClaimReward = async () => {
    setClaiming(true);
    setCelebrating(false);
    try {
      const result = await claimReward(questDef.id);
      if (!result.already_claimed) {
        playSound('fanfare');
        if (questDef.id === 'quest_3') {
          setShowCompletionModal(true);
        } else {
          toast.success(`You earned ${questDef.reward} credits!`, {
            message: 'Keep going — more quests await!',
            duration: 6000,
          });
        }
      }
    } catch (err) {
      toast.error('Failed to claim reward', { message: err.message });
    } finally {
      setClaiming(false);
    }
  };

  const positionStyle = {
    ...(position.left != null ? { left: position.left } : {}),
    ...(position.right != null ? { right: position.right } : {}),
    ...(position.bottom != null ? { bottom: position.bottom } : {}),
  };

  return (
    <>
    {/* Quest 3 completion modal — rendered outside quest panel to ensure centering */}
    {showCompletionModal && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowCompletionModal(false)}>
        <div className="bg-gray-800 border border-gray-600 rounded-2xl p-12 max-w-2xl mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="text-center mb-10">
            <div className="text-6xl mb-5">🎉</div>
            <h2 className="text-4xl font-bold text-white mb-3">Congratulations!</h2>
            <p className="text-green-400 font-semibold text-2xl">+{questDef.reward} credits earned</p>
          </div>
          <div className="space-y-5 text-gray-300 text-xl leading-relaxed">
            <p>Annotate every touch so your baller can take their game to the next level.</p>
            <p>Extract highlights anytime to post to Insta or send to college coaches.</p>
            <p className="text-white font-medium">Use your credits to create more AI-upscaled highlights!</p>
          </div>
          <button
            onClick={() => setShowCompletionModal(false)}
            className="mt-10 w-full py-4 bg-green-600 hover:bg-green-500 text-white font-bold text-xl rounded-xl transition-colors"
          >
            Vamos!
          </button>
        </div>
      </div>
    )}
    {!allQuestsDone && (
    <div
      ref={panelRef}
      className={`quest-overlay fixed z-50 quest-fade-in transition-all duration-300 ${expanded ? 'sm:w-[340px] sm:max-w-[calc(100vw-2rem)]' : ''}`}
      style={positionStyle}
    >
      <div className={`quest-card rounded-2xl overflow-hidden ${celebrating ? 'quest-celebrate' : ''}`}>
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar rounded-t-2xl" />

        {/* Collapsed / Header — always visible, clickable to toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center text-left hover:bg-white/[0.02] transition-colors ${
            expanded ? 'gap-3 px-4 pt-4 pb-3' : 'gap-2 px-3 py-2.5'
          }`}
        >
          <div className={`quest-icon-badge rounded-lg flex items-center justify-center flex-shrink-0 ${
            expanded ? 'w-7 h-7' : 'w-7 h-7'
          }`}>
            <ListChecks size={expanded ? 14 : 14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`quest-title leading-tight ${expanded ? 'text-sm' : 'text-sm'}`}>{questDef.title}</h3>
              <span className="quest-progress-text text-xs tabular-nums flex-shrink-0 ml-auto">
                {completedCount}/{totalCount}
              </span>
              {/* Inline reward badge */}
              {expanded && !isComplete && (
                <div className="quest-reward-badge flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  <Gem size={10} />
                  <span className="text-xs font-semibold">{questDef.reward}</span>
                </div>
              )}
            </div>
          </div>
          {expanded
            ? <ChevronDown size={16} className="text-white/30 flex-shrink-0" />
            : <ChevronUp size={14} className="text-white/30 flex-shrink-0" />
          }
        </button>

        {/* Expanded content */}
        {expanded && (
          <>


            {/* Steps */}
            <div className="px-4 pb-2">
              {questDef.steps.map((step, index) => {
                const done = steps[step.id] || false;
                const isCurrent = step.id === currentStepId;

                return (
                  <div
                    key={step.id}
                    className={`
                      ${isCurrent ? 'flex' : 'hidden sm:flex'} items-start gap-3.5 py-3
                      ${index < questDef.steps.length - 1 ? 'sm:border-b border-white/5' : ''}
                      ${isCurrent ? 'quest-step-current' : ''}
                    `}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {done ? (
                        <div className="quest-check-done w-6 h-6 rounded-lg quest-check-bg flex items-center justify-center">
                          <Check size={14} className="text-white" strokeWidth={3} />
                        </div>
                      ) : isCurrent ? (
                        <div className="w-6 h-6 rounded-lg border-2 quest-current-border quest-pulse" />
                      ) : (
                        <div className="w-6 h-6 rounded-lg border-2 border-white/10" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className={`leading-tight ${
                        done ? 'quest-step-done text-base' :
                        isCurrent ? 'quest-step-active text-base' :
                        'quest-step-inactive text-base'
                      }`}>
                        {step.title}
                      </p>
                      {isCurrent && (
                        <p className="quest-step-description text-sm mt-1 leading-snug">
                          {step.description}
                        </p>
                      )}
                    </div>

                    {isCurrent && (
                      <ChevronRight size={16} className="quest-chevron flex-shrink-0 mt-0.5" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Claim button — only shown when quest is complete */}
            {isComplete && (
              <div className="px-4 pb-4 pt-1">
                <button
                  onClick={handleClaimReward}
                  disabled={claiming}
                  className="quest-claim-btn quest-claim-pulse w-full flex items-center justify-center gap-2 py-3 rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed
                    text-white font-bold text-base
                    transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Gem size={18} />
                  {claiming ? 'Claiming...' : `Claim ${questDef.reward} Credits`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

    </div>
    )}
    </>
  );
}

export default QuestPanel;
