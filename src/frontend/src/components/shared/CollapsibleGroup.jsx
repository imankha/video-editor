import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

/**
 * CollapsibleGroup - A collapsible container for grouping related items
 *
 * Used for hierarchical display of projects/downloads grouped by game.
 *
 * @param {string} title - Group header title (e.g., game name)
 * @param {number} count - Number of items in the group
 * @param {boolean} defaultExpanded - Initial expanded state (default: false)
 * @param {React.ReactNode} children - Items to display when expanded
 * @param {string} className - Additional CSS classes
 *
 * @example
 * <CollapsibleGroup title="Vs Carlsbad Dec 6" count={3}>
 *   <ProjectCard project={project1} />
 *   <ProjectCard project={project2} />
 *   <ProjectCard project={project3} />
 * </CollapsibleGroup>
 */
export function CollapsibleGroup({
  title,
  count,
  defaultExpanded = false,
  children,
  className = '',
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

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
        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="mt-1 ml-3 pl-3 border-l border-gray-700/50">
          {children}
        </div>
      )}
    </div>
  );
}

export default CollapsibleGroup;
