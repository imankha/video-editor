import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

/**
 * CollapsibleGroup - A collapsible container for grouping related items
 *
 * Used for hierarchical display of projects/downloads grouped by game.
 *
 * @param {string} title - Group header title (e.g., game name)
 * @param {number} count - Number of items in the group
 * @param {Object} statusCounts - Optional status breakdown { done, inOverlay, inProgress, notStarted }
 * @param {boolean} defaultExpanded - Initial expanded state (default: false)
 * @param {React.ReactNode} children - Items to display when expanded
 * @param {string} className - Additional CSS classes
 *
 * @example
 * <CollapsibleGroup title="Vs Carlsbad Dec 6" count={3} statusCounts={{ done: 1, notStarted: 2 }}>
 *   <ProjectCard project={project1} />
 * </CollapsibleGroup>
 */
export function CollapsibleGroup({
  title,
  count,
  statusCounts,
  defaultExpanded = false,
  children,
  className = '',
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Sync with defaultExpanded when it changes (e.g., when data loads)
  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  // Determine which statuses to show in header (project-level counts)
  const showDoneHeader = statusCounts?.done > 0;
  const showInOverlayHeader = statusCounts?.inOverlay > 0;
  const showInProgressHeader = statusCounts?.inProgress > 0;
  const showNotStartedHeader = statusCounts?.notStarted > 0;

  // Determine which statuses to show in legend (segment-level presence)
  // Falls back to project-level counts if segments not provided
  const segments = statusCounts?.segments || {};
  const showDoneLegend = segments.done ?? statusCounts?.done > 0;
  const showInOverlayLegend = segments.inOverlay ?? statusCounts?.inOverlay > 0;
  const showInProgressLegend = segments.inProgress ?? statusCounts?.inProgress > 0;
  const showNotStartedLegend = segments.notStarted ?? statusCounts?.notStarted > 0;

  return (
    <div className={`mb-2 ${className}`}>
      {/* Group Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={[
          'w-full flex items-center gap-2 px-3 py-2',
          'bg-gray-800/50 hover:bg-gray-800',
          'rounded-lg transition-colors',
          'text-left cursor-pointer',
        ].join(' ')}
      >
        <ChevronIcon size={16} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate flex-1">
          {title}
        </span>

        {/* Status indicators in header (project counts) */}
        {statusCounts && (
          <div className="flex items-center gap-2 mr-2">
            {showDoneHeader && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-2 h-2 rounded-sm bg-green-500"></span>
                {statusCounts.done}
              </span>
            )}
            {showInOverlayHeader && (
              <span className="flex items-center gap-1 text-xs text-blue-300">
                <span className="w-2 h-2 rounded-sm bg-blue-300"></span>
                {statusCounts.inOverlay}
              </span>
            )}
            {showInProgressHeader && (
              <span className="flex items-center gap-1 text-xs text-blue-400">
                <span className="w-2 h-2 rounded-sm bg-blue-500"></span>
                {statusCounts.inProgress}
              </span>
            )}
            {showNotStartedHeader && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className="w-2 h-2 rounded-sm bg-gray-600"></span>
                {statusCounts.notStarted}
              </span>
            )}
          </div>
        )}

        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="mt-1 ml-3 pl-3 border-l border-gray-700/50">
          {/* Legend inside expanded content (shows all segment colors that appear in cards) */}
          {statusCounts && (showDoneLegend || showInOverlayLegend || showInProgressLegend || showNotStartedLegend) && (
            <div className="flex gap-3 text-xs text-gray-500 mb-2 pb-2 border-b border-gray-700/30">
              {showDoneLegend && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-green-500"></span>
                  Done
                </span>
              )}
              {showInProgressLegend && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-blue-500"></span>
                  In Progress
                </span>
              )}
              {showInOverlayLegend && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-blue-300"></span>
                  In Overlay
                </span>
              )}
              {showNotStartedLegend && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-gray-600"></span>
                  Not Started
                </span>
              )}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export default CollapsibleGroup;
