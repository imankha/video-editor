import { useState } from 'react';
import { Trophy, X, Check, Gift, Coins, ChevronRight, Sparkles } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { QUESTS } from '../config/questDefinitions';
import { toast } from './shared/Toast';

/**
 * QuestPanel — floating overlay card for quest progress (T540).
 *
 * Design principles (from NUF research):
 * - Auto-shows for new users, dismissible, re-opens via QuestIcon
 * - Floating card (not slide-out) — visually distinct from app chrome
 * - Progressive disclosure: shows one quest at a time
 * - Current step highlighted, completed steps have animated checkmarks
 * - Reward celebration when all steps complete
 */
export function QuestPanel() {
  const isOpen = useQuestStore((s) => s.isOpen);
  const close = useQuestStore((s) => s.close);
  const quests = useQuestStore((s) => s.quests);
  const activeQuestId = useQuestStore((s) => s.activeQuestId);
  const claimReward = useQuestStore((s) => s.claimReward);
  const [claiming, setClaiming] = useState(false);

  if (!isOpen) return null;

  // Find the active quest definition and progress
  const questDef = QUESTS.find(q => q.id === activeQuestId) || QUESTS[0];
  const questProgress = quests.find(q => q.id === activeQuestId);
  const steps = questProgress?.steps || {};
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = questDef.steps.length;
  const isComplete = completedCount === totalCount;
  const rewardClaimed = questProgress?.reward_claimed || false;
  const progressPercent = (completedCount / totalCount) * 100;

  // Find the first incomplete step (the "current" step to highlight)
  const currentStepId = questDef.steps.find(s => !steps[s.id])?.id;

  // Check if all quests are done
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
    <div className="quest-overlay fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] quest-fade-in">
      {/* Card */}
      <div className="rounded-2xl overflow-hidden shadow-2xl shadow-purple-900/30 border border-purple-500/20 bg-gradient-to-br from-gray-900 via-gray-900 to-purple-950">

        {/* Header — gradient accent bar */}
        <div className="relative px-5 pt-4 pb-3">
          {/* Accent gradient line at top */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Trophy size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm leading-tight">{questDef.title}</h3>
                <p className="text-purple-300/70 text-xs">{questDef.description}</p>
              </div>
            </div>
            <button
              onClick={close}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-bold text-purple-300 tabular-nums">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 pb-2">
          {questDef.steps.map((step, index) => {
            const done = steps[step.id] || false;
            const isCurrent = step.id === currentStepId;

            return (
              <div
                key={step.id}
                className={`
                  flex items-start gap-3 py-2.5
                  ${index < questDef.steps.length - 1 ? 'border-b border-white/5' : ''}
                  ${isCurrent ? 'quest-step-current' : ''}
                `}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0 mt-0.5">
                  {done ? (
                    <div className="quest-check-done w-5 h-5 rounded-md bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-sm shadow-green-500/30">
                      <Check size={12} className="text-white" strokeWidth={3} />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-5 h-5 rounded-md border-2 border-purple-400 bg-purple-400/10 quest-pulse" />
                  ) : (
                    <div className="w-5 h-5 rounded-md border-2 border-gray-700 bg-gray-800/50" />
                  )}
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium leading-tight ${
                    done ? 'text-green-400/80 line-through decoration-green-500/30' :
                    isCurrent ? 'text-white' :
                    'text-gray-500'
                  }`}>
                    {step.title}
                  </p>
                  {isCurrent && (
                    <p className="text-xs text-purple-300/60 mt-0.5 leading-snug">
                      {step.description}
                    </p>
                  )}
                </div>

                {/* Current indicator */}
                {isCurrent && (
                  <ChevronRight size={14} className="text-purple-400 flex-shrink-0 mt-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* Reward footer */}
        <div className="px-5 pb-4 pt-1">
          {rewardClaimed && !allQuestsDone ? (
            // Quest claimed, but more quests to go — this shouldn't show since we advance activeQuestId
            <div className="flex items-center gap-2 py-2 text-green-400">
              <Coins size={14} className="text-yellow-400" />
              <span className="text-xs font-medium">{questDef.reward} credits earned</span>
            </div>
          ) : allQuestsDone ? (
            // All done!
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
              <Sparkles size={16} className="text-yellow-400" />
              <span className="text-sm font-bold text-green-400">All quests complete!</span>
            </div>
          ) : isComplete ? (
            // All steps done, claim reward
            <button
              onClick={handleClaimReward}
              disabled={claiming}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                bg-gradient-to-r from-purple-600 to-pink-600
                hover:from-purple-500 hover:to-pink-500
                disabled:opacity-50 disabled:cursor-not-allowed
                text-white font-bold text-sm
                shadow-lg shadow-purple-500/25
                transition-all duration-200 hover:shadow-purple-500/40 hover:scale-[1.02]
                active:scale-[0.98]"
            >
              <Gift size={16} />
              {claiming ? 'Claiming...' : `Claim ${questDef.reward} Credits`}
            </button>
          ) : (
            // Still in progress
            <div className="flex items-center gap-2 py-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                <Gift size={12} className="text-purple-400" />
                <span className="text-xs font-medium text-purple-300">{questDef.reward} credits on completion</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuestPanel;
