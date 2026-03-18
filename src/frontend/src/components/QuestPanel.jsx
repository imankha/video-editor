import { useState } from 'react';
import { Compass, X, Check, Gem, ChevronRight, Sparkles } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { QUESTS } from '../config/questDefinitions';
import { toast } from './shared/Toast';

/**
 * QuestPanel — floating overlay card for quest progress (T540).
 *
 * Anchored bottom-left with generous padding from edges.
 * Visually distinct from app chrome — larger text, warm accent colors,
 * rounded card with shadow. Feels like a game overlay, not a settings panel.
 */
export function QuestPanel() {
  const isOpen = useQuestStore((s) => s.isOpen);
  const close = useQuestStore((s) => s.close);
  const quests = useQuestStore((s) => s.quests);
  const activeQuestId = useQuestStore((s) => s.activeQuestId);
  const claimReward = useQuestStore((s) => s.claimReward);
  const [claiming, setClaiming] = useState(false);

  if (!isOpen) return null;

  const questDef = QUESTS.find(q => q.id === activeQuestId) || QUESTS[0];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const steps = questProgress?.steps || {};
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = questDef.steps.length;
  const isComplete = completedCount === totalCount;
  const rewardClaimed = questProgress?.reward_claimed || false;
  const progressPercent = (completedCount / totalCount) * 100;
  const currentStepId = questDef.steps.find(s => !steps[s.id])?.id;
  const allQuestsDone = quests.every(q => q.reward_claimed);

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

        {/* Header */}
        <div className="relative px-6 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1.5 quest-accent-bar" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="quest-icon-badge w-10 h-10 rounded-xl flex items-center justify-center">
                <Compass size={20} className="text-white" />
              </div>
              <h3 className="quest-title text-lg">{questDef.title}</h3>
            </div>
            <button
              onClick={close}
              className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 flex items-center gap-3">
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
        </div>

        {/* Steps */}
        <div className="px-6 pb-3">
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
                {/* Checkbox */}
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

                {/* Text */}
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
        <div className="px-6 pb-5 pt-1">
          {allQuestsDone ? (
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl quest-all-done-bg">
              <Sparkles size={18} className="text-amber-300" />
              <span className="quest-all-done-text text-base">All quests complete!</span>
            </div>
          ) : isComplete ? (
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
      </div>
    </div>
  );
}

export default QuestPanel;
