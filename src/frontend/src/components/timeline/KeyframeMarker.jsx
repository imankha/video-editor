import React from 'react';
import { Trash2, Copy } from 'lucide-react';

/**
 * Reusable keyframe marker for timeline layers.
 * Supports different color schemes for each layer type (crop, highlight, etc.)
 * Used by CropLayer (blue/yellow) and HighlightLayer (orange).
 */
export function KeyframeMarker({
  position,              // 0-100 percentage position on timeline
  colorScheme = 'blue',  // 'blue' (crop) | 'orange' (highlight)
  isSelected = false,
  shouldHighlight = false,
  isPermanent = false,
  isStartKeyframe = false,
  isEndKeyframe = false,
  onClick,
  onCopy,
  onDelete,
  tooltip,
  edgePadding = 0,
  showCopyButton = true,
  showDeleteButton = true,
}) {
  // Color schemes for different layer types
  const colorSchemes = {
    blue: {
      default: 'bg-blue-400 hover:bg-blue-300',
      highlighted: 'bg-yellow-400 scale-125',
      selected: 'bg-yellow-300 scale-150 ring-2 ring-yellow-200',
    },
    orange: {
      default: 'bg-orange-500 hover:bg-orange-400',
      highlighted: 'bg-orange-400 scale-125',
      selected: 'bg-orange-300 scale-150 ring-2 ring-orange-200',
    },
  };

  const colors = colorSchemes[colorScheme] || colorSchemes.blue;

  // Determine marker color based on state
  const markerColorClass = isSelected
    ? colors.selected
    : shouldHighlight
    ? colors.highlighted
    : colors.default;

  // Determine copy button horizontal offset based on keyframe position
  const getCopyButtonTransform = () => {
    if (isPermanent && isStartKeyframe) {
      return '-translate-x-[20%]';
    }
    if (isPermanent && isEndKeyframe) {
      return '-translate-x-[80%]';
    }
    return '-translate-x-1/2';
  };

  return (
    <div
      className="absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50"
      style={{
        left: edgePadding > 0
          ? `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${position / 100})`
          : `${position}%`
      }}
    >
      {/* Invisible hit area that keeps buttons visible when moving mouse between elements */}
      <div className="absolute -top-5 -bottom-4 -left-4 -right-4" />

      {/* Copy button (shown when selected, above keyframe) - z-50 to appear above all UI including playhead */}
      {showCopyButton && onCopy && (
        <button
          className={`absolute -top-5 left-1/2 transform transition-opacity bg-blue-600 hover:bg-blue-700 text-white rounded-full p-1.5 z-50 ${getCopyButtonTransform()} ${
            isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          title="Copy keyframe"
        >
          <Copy size={13} />
        </button>
      )}

      {/* Diamond keyframe indicator */}
      <div
        className={`w-3 h-3 transform rotate-45 cursor-pointer transition-all ${markerColorClass}`}
        onClick={onClick}
        title={tooltip}
      />

      {/* Delete button (shown when selected) - z-50 to appear above all UI including playhead */}
      {showDeleteButton && onDelete && (
        <button
          className={`absolute top-4 left-1/2 transform -translate-x-1/2 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 z-50 ${
            isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete keyframe"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export default KeyframeMarker;
