/**
 * AspectRatioSelector component - Visual icon-based toggle for crop aspect ratio
 * Displays two clickable rectangle shapes: tall (9:16) and wide (16:9)
 */
export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange }) {
  const aspectRatios = [
    { value: '9:16', label: 'Portrait' },
    { value: '16:9', label: 'Landscape' }
  ];

  return (
    <div className="flex items-center gap-2">
      {aspectRatios.map((ratio) => {
        const isSelected = aspectRatio === ratio.value;
        const isTall = ratio.value === '9:16';

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
                ${isTall ? 'w-4 h-6' : 'w-6 h-4'}
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
