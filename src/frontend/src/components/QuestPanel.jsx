import { useState, useEffect } from 'react';
import { ListChecks, Check, Gem, ChevronRight, ChevronDown, ChevronUp, Sparkles, LogIn } from 'lucide-react';
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

  // Fetch quest progress on mount
  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // Subscribe to export events to refresh quest progress
  useEffect(() => {
    const unsub = exportWebSocketManager.addEventListener('*', 'complete', fetchProgress);
    return () => { unsub(); };
  }, [fetchProgress]);

  // Don't render if hidden, not loaded, or all quests fully done
  const allQuestsDone = loaded && quests.length > 0 && quests.every(q => q.reward_claimed);
  if (hidden || !loaded || allQuestsDone) return null;

  const questDef = QUESTS.find(q => q.id === activeQuestId) || QUESTS[0];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const steps = questProgress?.steps || {};
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = questDef.steps.length;
  const isComplete = completedCount === totalCount;
  const progressPercent = (completedCount / totalCount) * 100;
  const currentStepId = questDef.steps.find(s => !steps[s.id])?.id;

  const handleClaimReward = async () => {
    setClaiming(true);
    try {
      const result = await claimReward(questDef.id);
      if (!result.already_claimed) {
        toast.success(`You earned ${questDef.reward} credits!`, {
          message: 'Keep going — more quests await!',
          duration: 6000,
        });
      }
    } catch (err) {
      toast.error('Failed to claim reward', { message: err.message });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="quest-overlay fixed bottom-10 left-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] quest-fade-in">
      <div className="quest-card rounded-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar rounded-t-2xl" />

        {/* Collapsed / Header — always visible, clickable to toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 px-5 pt-5 pb-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="quest-icon-badge w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
            <ListChecks size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="quest-title text-base leading-tight">{questDef.title}</h3>
            {/* Mini progress bar in collapsed state */}
            {!expanded && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full quest-progress-fill transition-all duration-700 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="quest-progress-text text-xs tabular-nums flex-shrink-0">
                  {completedCount}/{totalCount}
                </span>
              </div>
            )}
          </div>
          {expanded
            ? <ChevronDown size={16} className="text-white/30 flex-shrink-0" />
            : <ChevronUp size={16} className="text-white/30 flex-shrink-0" />
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
                      flex items-start gap-3.5 py-3
                      ${index < questDef.steps.length - 1 ? 'border-b border-white/5' : ''}
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

            {/* Reward footer */}
            <div className="px-5 pb-5 pt-1">
              {isComplete ? (
                <button
                  onClick={handleClaimReward}
                  disabled={claiming}
                  className="quest-claim-btn w-full flex items-center justify-center gap-2 py-3 rounded-xl
                    disabled:opacity-50 disabled:cursor-not-allowed
                    text-white font-bold text-base
                    transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Gem size={18} />
                  {claiming ? 'Claiming...' : `Claim ${questDef.reward} Credits`}
                </button>
              ) : (
                <div className="flex items-center gap-2 py-1.5">
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
  );
}

export default QuestPanel;
