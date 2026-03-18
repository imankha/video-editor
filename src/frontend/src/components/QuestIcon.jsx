import { useEffect } from 'react';
import { Compass } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';

/**
 * QuestIcon — header button with progress ring (T540).
 *
 * Compact trophy icon with a circular progress indicator.
 * Clicking re-opens the quest overlay if dismissed.
 * Visible for all users (including unauthenticated) to guide onboarding.
 */
export function QuestIcon() {
  const totalCompleted = useQuestStore((s) => s.totalCompleted);
  const totalSteps = useQuestStore((s) => s.totalSteps);
  const loaded = useQuestStore((s) => s.loaded);
  const isOpen = useQuestStore((s) => s.isOpen);
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
  const progress = totalSteps > 0 ? totalCompleted / totalSteps : 0;

  // SVG progress ring params
  const size = 32;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <button
      onClick={open}
      title={loaded ? `Quests: ${totalCompleted}/${totalSteps}` : 'Quests'}
      className={`
        relative inline-flex items-center justify-center
        w-9 h-9 rounded-lg
        transition-all duration-200
        ${isOpen
          ? 'bg-amber-600/30 text-amber-300'
          : 'text-gray-400 hover:text-amber-300 hover:bg-white/10'
        }
      `}
    >
      {/* Progress ring */}
      <svg
        width={size}
        height={size}
        className="absolute inset-0 m-auto -rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="opacity-10"
        />
        {/* Progress */}
        {loaded && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={allDone ? '#22c55e' : '#fbbf24'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-700 ease-out"
          />
        )}
      </svg>

      {/* Trophy icon */}
      <Compass size={14} className={allDone ? 'text-green-400' : ''} />
    </button>
  );
}

export default QuestIcon;
