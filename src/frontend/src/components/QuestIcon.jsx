import { useEffect } from 'react';
import { Trophy } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { Button } from './shared/Button';

/**
 * QuestIcon — header button with progress badge (T540).
 *
 * Shows completed/total steps across all quests.
 * Visible for all users (including unauthenticated) to guide onboarding.
 * Subscribes to export events to refresh progress after exports complete.
 */
export function QuestIcon() {
  const totalCompleted = useQuestStore((s) => s.totalCompleted);
  const totalSteps = useQuestStore((s) => s.totalSteps);
  const loaded = useQuestStore((s) => s.loaded);
  const open = useQuestStore((s) => s.open);
  const fetchProgress = useQuestStore((s) => s.fetchProgress);

  // Fetch quest progress on mount
  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // Subscribe to export events to refresh quest progress
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', fetchProgress);
    return () => { unsubComplete(); };
  }, [fetchProgress]);

  const allDone = loaded && totalCompleted === totalSteps;

  return (
    <Button
      variant="ghost"
      size="md"
      icon={Trophy}
      onClick={open}
      title="Quests"
    >
      <span className="hidden sm:inline">
        {loaded ? `${totalCompleted}/${totalSteps}` : 'Quests'}
      </span>
      {allDone && (
        <span className="px-1.5 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          ✓
        </span>
      )}
    </Button>
  );
}

export default QuestIcon;
