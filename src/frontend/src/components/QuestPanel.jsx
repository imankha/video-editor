import { useState, useEffect, useRef, useCallback } from 'react';
import { ListChecks, Check, Gem, ChevronRight, ChevronDown, ChevronUp, LogIn } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { QUESTS } from '../config/questDefinitions';
import { toast } from './shared/Toast';
import { useAuthStore } from '../stores/authStore';
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const claimReward = useQuestStore((s) => s.claimReward);

  const [expanded, setExpanded] = useState(true);  // Start expanded for new users
  const [hidden, setHidden] = useState(false);       // User fully dismissed
  const [claiming, setClaiming] = useState(false);
  const [celebrating, setCelebrating] = useState(false);  // Quest complete celebration
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const prevCompletedRef = useRef(null);  // Track step count to detect new completions
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ left: null, bottom: null });

  // Smart positioning: avoid overlapping active UI (sidebars, panels)
  const updatePosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Default position (matches CSS: bottom-3 left-3 → 12px, sm: bottom-10 left-6 → 40px/24px)
    const isSm = window.innerWidth >= 640;
    const defaultLeft = isSm ? 24 : 12;
    const defaultBottom = isSm ? 40 : 12;

    // Check if any UI element occupies our default spot
    // Look for sidebars/panels on the left side that extend to the bottom
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height;
    const panelWidth = panelRect.width;

    // Query elements that might overlap at bottom-left
    const checkPoint = { x: defaultLeft + panelWidth / 2, y: window.innerHeight - defaultBottom - panelHeight / 2 };
    const elementsAtPoint = document.elementsFromPoint(checkPoint.x, checkPoint.y);
    const overlapping = elementsAtPoint.find(el =>
      el !== panel && !panel.contains(el) && !el.contains(panel) &&
      el.closest('[data-sidebar], [class*="sidebar"], [class*="side-panel"], [class*="SidePanel"]')
    );

    if (overlapping) {
      const overlapRect = overlapping.closest('[data-sidebar], [class*="sidebar"], [class*="side-panel"], [class*="SidePanel"]').getBoundingClientRect();
      // Position just to the right of the overlapping element
      const newLeft = overlapRect.right + 12;
      // Check if it fits on screen; if not, try bottom-right
      if (newLeft + panelWidth < window.innerWidth - 12) {
        setPosition({ left: newLeft, bottom: defaultBottom });
      } else {
        // Fall back to bottom-right
        setPosition({ left: null, right: isSm ? 24 : 12, bottom: defaultBottom });
      }
    } else {
      setPosition({ left: defaultLeft, bottom: defaultBottom });
    }
  }, []);

  useEffect(() => {
    // Run after render to measure
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    // Re-check when layout changes (sidebar open/close)
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

  // Fetch quest progress on mount
  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

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
      className={`quest-overlay fixed z-50 quest-fade-in transition-all duration-300 ${expanded ? 'sm:w-[420px] sm:max-w-[calc(100vw-2rem)]' : ''}`}
      style={positionStyle}
    >
      <div className={`quest-card rounded-2xl overflow-hidden ${celebrating ? 'quest-celebrate' : ''}`}>
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar rounded-t-2xl" />

        {/* Collapsed / Header — always visible, clickable to toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center text-left hover:bg-white/[0.02] transition-colors ${
            expanded ? 'gap-3 px-5 pt-5 pb-4' : 'gap-2 px-3 py-2.5'
          }`}
        >
          <div className={`quest-icon-badge rounded-xl flex items-center justify-center flex-shrink-0 ${
            expanded ? 'w-9 h-9' : 'w-7 h-7'
          }`}>
            <ListChecks size={expanded ? 18 : 14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`quest-title leading-tight ${expanded ? 'text-base' : 'text-sm'}`}>{questDef.title}</h3>
              {/* Progress count — shown inline when collapsed */}
              {!expanded && (
                <span className="quest-progress-text text-xs tabular-nums flex-shrink-0 ml-auto">
                  {completedCount}/{totalCount}
                </span>
              )}
              {/* Inline reward badge — mobile only, expanded */}
              {expanded && !isComplete && (
                <div className="sm:hidden quest-reward-badge flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-auto">
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
            {/* Progress bar */}
            <div className="px-5 pb-3 flex items-center gap-3">
              <div className="flex-1 h-2.5 bg-black/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full quest-progress-fill transition-all duration-700 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="quest-progress-text text-sm tabular-nums">
                {completedCount}/{totalCount}
              </span>
            </div>

            {/* Hint — login button for returning users, hidden once authenticated */}
            {questDef.hint && !isAuthenticated && (
              <button
                onClick={() => useAuthStore.getState().requireAuth(() => {})}
                className="mx-5 mb-3 w-[calc(100%-2.5rem)] flex items-center justify-center gap-2 text-sm font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-3 py-2.5 transition-colors cursor-pointer"
              >
                <LogIn size={14} />
                {questDef.hint}
              </button>
            )}

            {/* Steps */}
            <div className="px-5 pb-3">
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

            {/* Reward footer — hidden on mobile unless quest is complete (reward shown inline in header) */}
            <div className={`px-5 pb-5 pt-1 ${isComplete ? '' : 'hidden sm:block'}`}>
              {isComplete ? (
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
              ) : (
                <div className="hidden sm:flex items-center gap-2 py-1.5">
                  <div className="quest-reward-badge flex items-center gap-2 px-3 py-1.5 rounded-full">
                    <Gem size={14} />
                    <span className="text-sm font-semibold">{questDef.reward} credits</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
    )}
    </>
  );
}

export default QuestPanel;
