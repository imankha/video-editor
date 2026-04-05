import React, { useState, useMemo } from 'react';
import { useQuestStore } from '../../stores/questStore';
import { STEP_TITLES } from '../../config/questDefinitions.jsx';

/** Extensible color palette for quest bars */
const QUEST_COLORS = [
  { bar: 'bg-purple-500', hover: 'bg-purple-400', dot: 'bg-purple-500' },
  { bar: 'bg-blue-500', hover: 'bg-blue-400', dot: 'bg-blue-500' },
  { bar: 'bg-emerald-500', hover: 'bg-emerald-400', dot: 'bg-emerald-500' },
  { bar: 'bg-amber-500', hover: 'bg-amber-400', dot: 'bg-amber-500' },
  { bar: 'bg-rose-500', hover: 'bg-rose-400', dot: 'bg-rose-500' },
];

/**
 * QuestFunnelChart — bar graph showing how many users completed each step.
 * Derives quest count, colors, and legend from backend definitions (T1000).
 *
 * Props:
 * - users: array from GET /api/admin/users (authenticated users only — guests filtered upstream)
 */
export function QuestFunnelChart({ users }) {
  const definitions = useQuestStore((s) => s.definitions);
  const [hovered, setHovered] = useState(null);

  // Build flat step list from definitions
  const allSteps = useMemo(() => {
    if (!definitions) return [];
    return definitions.flatMap((quest, qi) =>
      quest.step_ids.map((stepId, si) => ({
        stepId,
        title: STEP_TITLES[stepId] || stepId,
        questTitle: quest.title,
        questIndex: qi + 1,
        stepWithinQuest: si + 1,
      }))
    );
  }, [definitions]);

  // Quest boundary indices for color banding
  const questBoundaries = useMemo(() => {
    if (!definitions) return [];
    return definitions.reduce((acc, q, i) => {
      const prev = acc[i - 1] ?? -1;
      acc.push(prev + q.step_ids.length);
      return acc;
    }, []);
  }, [definitions]);

  if (!definitions) return null;

  // Count completions per step
  const counts = allSteps.map(({ stepId, questIndex }) => {
    const questKey = `quest_${questIndex}`;
    return users.filter(u => u.quest_progress?.[questKey]?.steps?.[stepId]).length;
  });

  const maxCount = Math.max(...counts, 1);

  function questColor(stepIndex) {
    for (let i = 0; i < questBoundaries.length; i++) {
      if (stepIndex <= questBoundaries[i]) return QUEST_COLORS[i % QUEST_COLORS.length];
    }
    return QUEST_COLORS[QUEST_COLORS.length - 1];
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-gray-400 text-xs">Users</span>
        <div className="flex items-center gap-4 text-xs text-gray-300">
          {definitions.map((q, i) => (
            <span key={q.id}>
              <span className={`inline-block w-2 h-2 rounded-sm ${QUEST_COLORS[i % QUEST_COLORS.length].dot} mr-1`} />
              Q{i + 1} {q.title}
            </span>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {/* Y-axis gridlines */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ paddingBottom: '28px' }}>
          {[maxCount, Math.round(maxCount / 2), 0].map((v, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-gray-400 text-[10px] w-4 text-right">{v}</span>
              <div className="flex-1 border-t border-white/10" />
            </div>
          ))}
        </div>

        {/* Bars */}
        <div className="flex items-end gap-0.5 pl-6" style={{ height: '160px' }}>
          {allSteps.map((step, i) => {
            const count = counts[i];
            const heightPct = (count / maxCount) * 100;
            const colors = questColor(i);
            const isHovered = hovered === i;

            return (
              <div
                key={step.stepId}
                className="relative flex-1 flex flex-col justify-end cursor-pointer group"
                style={{ height: '100%' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Bar */}
                <div
                  className={`w-full rounded-t transition-colors ${isHovered ? colors.hover : colors.bar}`}
                  style={{ height: `${Math.max(heightPct, count > 0 ? 2 : 0)}%` }}
                />

                {/* Tooltip */}
                {isHovered && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                    <div className="bg-gray-800 border border-white/20 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-xl">
                      <div className="text-white font-medium mb-0.5">{step.title}</div>
                      <div className="text-gray-400">Q{step.questIndex} · Step {step.stepWithinQuest} (#{i + 1} overall)</div>
                      <div className="text-purple-300 mt-1">{count} user{count !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* X-axis: quest labels */}
        <div className="flex pl-6 mt-1">
          {definitions.map((quest, qi) => (
            <div
              key={quest.id}
              className="text-center text-[10px] text-gray-400"
              style={{ flex: quest.step_ids.length }}
            >
              Q{qi + 1}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
