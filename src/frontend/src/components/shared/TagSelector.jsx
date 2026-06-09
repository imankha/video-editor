import { Check } from 'lucide-react';

const SIZE_CONFIG = {
  sm: { text: 'text-[11px]', gap: 'gap-1', padding: 'px-1.5 py-1', checkSize: 10, spacing: 'space-y-1.5' },
  md: { text: 'text-xs', gap: 'gap-1', padding: 'px-2 py-1', checkSize: 12, spacing: 'space-y-2', rounded: 'rounded' },
  lg: { text: 'text-sm', gap: 'gap-2', padding: 'px-3 py-1.5', checkSize: 14, spacing: 'space-y-3', rounded: 'rounded-lg' },
};

/**
 * TagSelector - Multi-select tags grouped by position
 *
 * @param {Array} positions - Array of { id, name } position objects
 * @param {Object} tagsByPosition - Map of positionId -> [{ name, description }]
 * @param {string[]} selectedTags - Array of selected tag names
 * @param {function} onTagToggle - Callback when tag is toggled (receives tag name)
 * @param {'sm'|'md'|'lg'} size - Visual size variant (default 'md')
 * @param {boolean} showLabels - Show position group labels (default false)
 */
export function TagSelector({ positions, tagsByPosition, selectedTags = [], onTagToggle, size = 'md', showLabels = false, flat = false }) {
  const cfg = SIZE_CONFIG[size] || SIZE_CONFIG.md;

  const renderTag = (tag) => {
    const isSelected = selectedTags.includes(tag.name);
    return (
      <button
        key={tag.name}
        onClick={() => onTagToggle(tag.name)}
        className={`flex items-center gap-1 ${cfg.padding} ${cfg.text} ${cfg.rounded || 'rounded'} transition-colors whitespace-nowrap ${
          isSelected
            ? 'bg-green-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
        title={tag.description}
        type="button"
      >
        {isSelected && <Check size={cfg.checkSize} />}
        {tag.name}
      </button>
    );
  };

  if (flat) {
    const allTags = positions.flatMap(pos => tagsByPosition[pos.id] || []);
    return (
      <div className={`flex flex-nowrap ${cfg.gap}`}>
        {allTags.map(renderTag)}
      </div>
    );
  }

  return (
    <div className={cfg.spacing}>
      {positions.map((pos) => {
        const tags = tagsByPosition[pos.id] || [];
        return (
          <div key={pos.id}>
            {showLabels && (
              <div className={`text-gray-500 ${cfg.text} mb-1`}>
                {pos.name}
              </div>
            )}
            <div className={`flex flex-wrap ${cfg.gap}`}>
              {tags.map(renderTag)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TagSelector;
