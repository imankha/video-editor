/**
 * AspectRatioSelector component - Visual icon-based toggle for crop aspect ratio
 * Displays two clickable rectangle shapes: tall (9:16) and wide (16:9)
 *
 * Props:
 * - aspectRatio: Current aspect ratio ('9:16' or '16:9')
 * - onAspectRatioChange: Callback when user changes aspect ratio
 *
 * There is deliberately no read-only variant: a control-shaped element that cannot be
 * tapped reads as a broken button on touch (prod bugs 41p/42p, T7130).
 */
const ASPECT_RATIOS = [
  { value: '9:16', label: 'Portrait' },
  { value: '16:9', label: 'Landscape' }
];

export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange }) {
  return (
    <div className="flex items-center gap-2">
      {ASPECT_RATIOS.map((ratio) => {
        const isSelected = aspectRatio === ratio.value;
        const isRatioTall = ratio.value === '9:16';

        return (
          <button
            key={ratio.value}
            onClick={() => onAspectRatioChange(ratio.value)}
            className={`
              relative flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-all
              min-h-11 min-w-11 lg:min-h-0 lg:min-w-0
              ${isSelected
                ? 'bg-purple-600 ring-2 ring-purple-400'
                : 'bg-gray-800 hover:bg-gray-700 border border-gray-600'
              }
            `}
            title={`${ratio.value} ${ratio.label}`}
            aria-pressed={isSelected}
          >
            {/* Rectangle icon */}
            <div
              className={`
                border-2 rounded-sm transition-colors
                ${isSelected ? 'border-white bg-purple-500/30' : 'border-gray-400 bg-gray-700/50'}
                ${isRatioTall ? 'w-4 h-6' : 'w-6 h-4'}
              `}
            />
            {/* Ratio label */}
            <span className={`text-xs font-medium ${isSelected ? 'text-white' : 'text-gray-400'}`}>
              {ratio.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
