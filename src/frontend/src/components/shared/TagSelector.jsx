import { Check } from 'lucide-react';
import { soccerTags, positions } from '../../modes/annotate/constants/soccerTags';

/**
 * TagSelector - Multi-select tags grouped by position
 * Shows all tags from all positions, allowing selection from multiple positions
 *
 * @param {string[]} selectedTags - Array of selected tag short names
 * @param {function} onTagToggle - Callback when tag is toggled (receives tag shortName)
 * @param {boolean} compact - Use compact layout (default false)
 */
export function TagSelector({ selectedTags = [], onTagToggle, compact = false }) {
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {positions.map((pos) => {
        const positionTags = soccerTags[pos.id] || [];
        return (
          <div key={pos.id}>
            <div className={`text-gray-500 ${compact ? 'text-[10px]' : 'text-xs'} mb-1`}>
              {pos.name}
            </div>
            <div className="flex flex-wrap gap-1">
              {positionTags.map((tag) => {
                const isSelected = selectedTags.includes(tag.shortName);
                return (
                  <button
                    key={tag.shortName}
                    onClick={() => onTagToggle(tag.shortName)}
                    className={`flex items-center gap-1 px-2 py-1 ${compact ? 'text-[10px]' : 'text-xs'} rounded transition-colors ${
                      isSelected
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title={tag.description}
                    type="button"
                  >
                    {isSelected && <Check size={compact ? 10 : 12} />}
                    {tag.shortName}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TagSelector;
