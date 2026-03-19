import React, { useState } from 'react';
import { QUESTS } from '../../config/questDefinitions';

/**
 * Flat list of every step in order, with quest metadata attached.
 * Absolute step index (0-based) used for the x-axis.
 */
const ALL_STEPS = QUESTS.flatMap((quest, qi) =>
  quest.steps.map((step, si) => ({
    stepId: step.id,
    title: step.title,
    questTitle: quest.title,
    questIndex: qi + 1,       // 1-based quest number
    stepWithinQuest: si + 1,  // 1-based step within quest
  }))
);

/**
 * QuestFunnelChart — bar graph showing how many users completed each step.
 *
 * Props:
 * - users: array from GET /api/admin/users (authenticated users only — guests filtered upstream)
 */
export function QuestFunnelChart({ users }) {
  const [hovered, setHovered] = useState(null); // absolute step index

  // Count completions per step
  const counts = ALL_STEPS.map(({ stepId, questIndex }) => {
    const questKey = `quest_${questIndex}`;
    return users.filter(u => u.quest_progress?.[questKey]?.steps?.[stepId]).length;
  });

  const maxCount = Math.max(...counts, 1);

  // Quest boundary indices for color banding
  const questBoundaries = QUESTS.reduce((acc, q, i) => {
    const prev = acc[i - 1] ?? -1;
    acc.push(prev + q.steps.length);
    return acc;
  }, []);

  function questColor(stepIndex) {
    if (stepIndex <= questBoundaries[0]) return { bar: 'bg-purple-500', hover: 'bg-purple-400' };
    if (stepIndex <= questBoundaries[1]) return { bar: 'bg-blue-500', hover: 'bg-blue-400' };
    return { bar: 'bg-emerald-500', hover: 'bg-emerald-400' };
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-gray-400 text-xs">Users</span>
        <div className="flex items-center gap-4 text-xs text-gray-300">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-purple-500 mr-1" />Q1 Get Started</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-1" />Q2 Export Highlights</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Q3 Highlight Reel</span>
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
          {ALL_STEPS.map((step, i) => {
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
          {QUESTS.map((quest, qi) => (
            <div
              key={quest.id}
              className="text-center text-[10px] text-gray-400"
              style={{ flex: quest.steps.length }}
            >
              Q{qi + 1}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
