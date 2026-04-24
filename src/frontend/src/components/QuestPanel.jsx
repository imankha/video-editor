import { useState, useEffect, useRef } from 'react';
import { ListChecks, Check, Gem, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { useEditorStore } from '../stores/editorStore';
import { useAuthStore } from '../stores/authStore';
import { STEP_TITLES, STEP_DESCRIPTIONS } from '../config/questDefinitions.jsx';
import { toast } from './shared/Toast';

import exportWebSocketManager from '../services/ExportWebSocketManager';

/**
 * T1030: Per-mode position config for the quest panel.
 * Instead of auto-collapsing when overlapping controls, the panel
 * repositions to empty screen space depending on the current editor mode.
 *
 * - Home/Projects: default bottom-left (no overlap issues)
 * - Annotate: anchored above the clip details section (measured dynamically)
 * - Framing: moved up above the timeline/scrub bar region
 * - Overlay: same as framing (similar bottom layout)
 */
const QUEST_PANEL_GAP = 8; // px gap between quest panel bottom and clip details top

function getPositionForMode(editorMode, isSm, clipDetailsBottom) {
  if (!isSm) return { left: 12, bottom: 12 }; // Mobile: always bottom-left, compact

  switch (editorMode) {
    case 'annotate':
      // Anchor bottom of quest panel to top of clip details (with gap)
      return { left: 24, bottom: clipDetailsBottom };
    case 'framing':
    case 'overlay':
      // Bottom-left, raised above the timeline/scrub bar
      return { left: 24, bottom: 220 };
    default:
      // Home / Project Manager — default bottom-left
      return { left: 24, bottom: 40 };
  }
}

/**
 * QuestPanel — self-contained floating overlay with collapsed/expanded states (T540).
 *
 * Collapsed: icon + quest title + progress (e.g., "Get Started  2/5")
 * Expanded: full step checklist + reward
 *
 * No header button needed — this component handles its own visibility,
 * fetching, and event subscriptions.
 */
export function QuestPanel({ inline = false }) {
  const definitions = useQuestStore((s) => s.definitions);
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

  // T1030: Read editorMode for smart repositioning (replaces auto-collapse)
  const editorMode = useEditorStore((s) => s.editorMode);
  const isExpanded = expanded;

  // T1030: Measure clip details position for annotate mode anchoring
  const [clipDetailsBottom, setClipDetailsBottom] = useState(340); // fallback
  useEffect(() => {
    if (editorMode !== 'annotate') return;
    const measure = () => {
      const el = document.querySelector('[data-clip-details]');
      if (el) {
        const bottom = window.innerHeight - el.getBoundingClientRect().top + QUEST_PANEL_GAP;
        setClipDetailsBottom(bottom);
      }
    };
    // Measure after DOM settles (clip details may not be mounted yet)
    const timer = setTimeout(measure, 100);
    // Re-measure on resize
    window.addEventListener('resize', measure);
    // Re-measure periodically while in annotate mode (clip selection changes layout)
    const interval = setInterval(measure, 500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
      clearInterval(interval);
    };
  }, [editorMode]);

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
  // Listen for 'progress' (job created → export_reel step) and 'complete' (job done → wait_for_reel step)
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', fetchProgress);
    const unsubProgress = exportWebSocketManager.addEventListener('*', 'progress', fetchProgress);
    return () => { unsubComplete(); unsubProgress(); };
  }, [fetchProgress]);

  // Detect step completions and quest completions for audio/animation
  const questDef = definitions?.find(q => q.id === activeQuestId) || definitions?.[0];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const currentCompleted = questProgress
    ? Object.values(questProgress.steps).filter(Boolean).length
    : 0;

  useEffect(() => {
    if (!questDef) return;
    if (prevCompletedRef.current === null) {
      // First load — just record, don't play sound
      prevCompletedRef.current = currentCompleted;
      return;
    }
    if (currentCompleted > prevCompletedRef.current) {
      const questStepCount = questDef.step_ids.length;
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

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Don't render if hidden, not loaded, definitions not fetched, or all quests done
  const allQuestsDone = loaded && quests.length > 0 && quests.every(q => q.reward_claimed);
  if ((hidden || !loaded || !definitions || !questDef || (isAuthenticated && allQuestsDone)) && !showCompletionModal) {
    return null;
  }
  const steps = questProgress?.steps || {};
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = questDef.step_ids.length;
  const isComplete = completedCount === totalCount;
  const progressPercent = (completedCount / totalCount) * 100;
  const currentStepId = questDef.step_ids.find(sid => !steps[sid]);

  const handleClaimReward = async () => {
    setClaiming(true);
    setCelebrating(false);
    try {
      const result = await claimReward(questDef.id);
      if (!result.already_claimed) {
        playSound('fanfare');
        if (questDef.id === 'quest_4') {
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

  // T1030: Smart repositioning — pick position per screen mode to avoid overlapping controls
  const isSm = window.innerWidth >= 640;
  const positionStyle = getPositionForMode(editorMode, isSm, clipDetailsBottom);

  // T1600: On mobile home screen, make quest panel static (below fold) instead of fixed overlay.
  // Static positioning ignores left/bottom inline styles, so positionStyle is harmless.
  const isMobileHome = !isSm && inline;

  return (
    <>
    {/* Quest 3 completion modal — rendered outside quest panel to ensure centering */}
    {showCompletionModal && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowCompletionModal(false)}>
        <div className="bg-gray-800 border border-gray-600 rounded-2xl p-6 sm:p-12 max-w-2xl mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="text-center mb-6 sm:mb-10">
            <div className="text-4xl sm:text-6xl mb-3 sm:mb-5">🎉</div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white mb-2 sm:mb-3">Congratulations!</h2>
            <p className="text-green-400 font-semibold text-xl sm:text-2xl">+{questDef.reward} credits earned</p>
          </div>
          <div className="space-y-3 sm:space-y-5 text-gray-300 text-base sm:text-xl leading-relaxed">
            <p>Annotate every touch so your baller can take their game to the next level.</p>
            <p>Extract highlights anytime to post to Insta or send to college coaches.</p>
            <p className="text-white font-medium">Use your credits to create more AI-upscaled highlights!</p>
          </div>
          <button
            onClick={() => setShowCompletionModal(false)}
            className="mt-6 sm:mt-10 w-full py-3 sm:py-4 bg-green-600 hover:bg-green-500 text-white font-bold text-lg sm:text-xl rounded-xl transition-colors"
          >
            Vamos!
          </button>
        </div>
      </div>
    )}
    {!allQuestsDone && (
    <div
      ref={panelRef}
      className={`quest-overlay ${isMobileHome ? 'static mx-3 mt-6 mb-6' : 'fixed'} sm:fixed z-50 quest-fade-in transition-all duration-300 ${isExpanded ? 'sm:w-[340px] sm:max-w-[calc(100vw-2rem)]' : ''}`}
      style={positionStyle}
    >
      <div className={`quest-card rounded-2xl overflow-hidden ${celebrating ? 'quest-celebrate' : ''}`}>
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar rounded-t-2xl" />

        {/* Collapsed / Header — always visible, clickable to toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center text-left hover:bg-white/[0.02] transition-colors ${
            isExpanded ? 'gap-3 px-4 pt-4 pb-3' : 'gap-2 px-3 py-2.5'
          }`}
        >
          <div className={`quest-icon-badge rounded-lg flex items-center justify-center flex-shrink-0 ${
            isExpanded ? 'w-7 h-7' : 'w-7 h-7'
          }`}>
            <ListChecks size={isExpanded ? 14 : 14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`quest-title leading-tight ${isExpanded ? 'text-sm' : 'text-sm'}`}>{questDef.title}</h3>
              <span className="quest-progress-text text-xs tabular-nums flex-shrink-0 ml-auto">
                {completedCount}/{totalCount}
              </span>
              {/* Inline reward badge */}
              {isExpanded && !isComplete && (
                <div className="quest-reward-badge flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  <Gem size={10} />
                  <span className="text-xs font-semibold">{questDef.reward}</span>
                </div>
              )}
            </div>
          </div>
          {isExpanded
            ? <ChevronDown size={16} className="text-white/30 flex-shrink-0" />
            : <ChevronUp size={14} className="text-white/30 flex-shrink-0" />
          }
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <>


            {/* Steps */}
            <div className="px-4 pb-2">
              {questDef.step_ids.map((stepId, index) => {
                const done = steps[stepId] || false;
                const isCurrent = stepId === currentStepId;

                return (
                  <div
                    key={stepId}
                    className={`
                      ${isCurrent ? 'flex' : 'hidden sm:flex'} items-start gap-3.5 py-3
                      ${index < questDef.step_ids.length - 1 ? 'sm:border-b border-white/5' : ''}
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
                        {STEP_TITLES[stepId] || stepId}
                      </p>
                      {isCurrent && (
                        <p className="quest-step-description text-sm mt-1 leading-snug">
                          {STEP_DESCRIPTIONS[stepId]}
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
