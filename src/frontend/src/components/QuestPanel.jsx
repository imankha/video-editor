import { Trophy, X, Check, Circle, Gift, Coins } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import { QUESTS } from '../config/questDefinitions';
import { Button } from './shared/Button';
import { toast } from './shared/Toast';

/**
 * QuestPanel — slide-out panel showing quest progress and rewards (T540).
 *
 * Follows the same pattern as DownloadsPanel:
 * - Reads isOpen from questStore
 * - Backdrop at z-40, panel at z-50
 * - animate-slide-in-right animation
 */
export function QuestPanel() {
  const isOpen = useQuestStore((s) => s.isOpen);
  const close = useQuestStore((s) => s.close);
  const quests = useQuestStore((s) => s.quests);
  const claimReward = useQuestStore((s) => s.claimReward);

  if (!isOpen) return null;

  // Build a map of quest progress from backend
  const questProgressMap = {};
  for (const q of quests) {
    questProgressMap[q.id] = q;
  }

  const handleClaimReward = async (questId, reward) => {
    try {
      const result = await claimReward(questId);
      if (result.already_claimed) {
        toast.info('Reward already claimed');
      } else {
        toast.success(`Earned ${reward} credits!`, {
          message: 'Credits added to your balance',
        });
      }
    } catch (err) {
      toast.error('Failed to claim reward', { message: err.message });
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={close}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-gray-800 shadow-xl z-50 flex flex-col border-l border-gray-700 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Trophy size={20} className="text-yellow-400" />
            <h2 className="text-lg font-bold text-white">Quests</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            iconOnly
            onClick={close}
          />
        </div>

        {/* Quest list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {QUESTS.map((quest) => {
            const progress = questProgressMap[quest.id];
            const steps = progress?.steps || {};
            const completedCount = Object.values(steps).filter(Boolean).length;
            const totalCount = quest.steps.length;
            const isComplete = completedCount === totalCount;
            const rewardClaimed = progress?.reward_claimed || false;

            return (
              <div
                key={quest.id}
                className="bg-gray-750 border border-gray-700 rounded-lg overflow-hidden"
              >
                {/* Quest header */}
                <div className="p-4 border-b border-gray-700/50">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-white font-semibold">{quest.title}</h3>
                    <span className="text-sm text-gray-400">
                      {completedCount}/{totalCount}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{quest.description}</p>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${
                        isComplete ? 'bg-green-500' : 'bg-purple-500'
                      }`}
                      style={{ width: `${(completedCount / totalCount) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Steps */}
                <div className="p-4 space-y-3">
                  {quest.steps.map((step) => {
                    const done = steps[step.id] || false;

                    return (
                      <div key={step.id} className="flex gap-3">
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-0.5">
                          {done ? (
                            <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                              <Check size={12} className="text-white" />
                            </div>
                          ) : (
                            <Circle size={20} className="text-gray-600" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${done ? 'text-green-400' : 'text-gray-300'}`}>
                            {step.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Reward section */}
                <div className="p-4 border-t border-gray-700/50">
                  {rewardClaimed ? (
                    <div className="flex items-center gap-2 text-green-400">
                      <Coins size={16} className="text-yellow-400" />
                      <span className="text-sm font-medium">{quest.reward} credits earned</span>
                      <Check size={14} />
                    </div>
                  ) : isComplete ? (
                    <button
                      onClick={() => handleClaimReward(quest.id, quest.reward)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                    >
                      <Gift size={16} />
                      Claim {quest.reward} credits
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Gift size={16} />
                      <span className="text-sm">Reward: {quest.reward} credits</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default QuestPanel;
