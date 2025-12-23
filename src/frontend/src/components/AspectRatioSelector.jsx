/**
 * AspectRatioSelector component - Visual icon-based toggle for crop aspect ratio
 * Displays two clickable rectangle shapes: tall (9:16) and wide (16:9)
 *
 * Props:
 * - aspectRatio: Current aspect ratio ('9:16' or '16:9')
 * - onAspectRatioChange: Callback when user changes aspect ratio (null for read-only mode)
 * - readOnly: If true, only shows current selection without buttons
 */
export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange, readOnly = false }) {
  const isTall = aspectRatio === '9:16';
  const label = isTall ? 'Portrait' : 'Landscape';

  // Read-only mode: just show the current aspect ratio
  if (readOnly || !onAspectRatioChange) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg border border-gray-600"
        title={`${aspectRatio} ${label} (set by project)`}
      >
        {/* Rectangle icon */}
        <div
          className={`
            border-2 rounded-sm border-purple-400 bg-purple-500/30
            ${isTall ? 'w-4 h-6' : 'w-6 h-4'}
          `}
        />
        {/* Ratio label */}
        <span className="text-xs font-medium text-gray-300">
          {aspectRatio}
        </span>
      </div>
    );
  }

  // Interactive mode: show both options as buttons
  const aspectRatios = [
    { value: '9:16', label: 'Portrait' },
    { value: '16:9', label: 'Landscape' }
  ];

  return (
    <div className="flex items-center gap-2">
      {aspectRatios.map((ratio) => {
        const isSelected = aspectRatio === ratio.value;
        const isRatioTall = ratio.value === '9:16';

        return (
          <button
            key={ratio.value}
            onClick={() => onAspectRatioChange(ratio.value)}
            className={`
              relative flex flex-col items-center gap-1 p-2 rounded-lg transition-all
              ${isSelected
                ? 'bg-purple-600 ring-2 ring-purple-400'
                : 'bg-gray-800 hover:bg-gray-700 border border-gray-600'
              }
            `}
            title={`${ratio.value} ${ratio.label}`}
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
