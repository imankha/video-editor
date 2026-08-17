import { RATIO, RATIO_ORDER, ratioLabel } from '../constants/aspectRatios';

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
export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange }) {
  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label={`Reel aspect ratio, currently ${aspectRatio}`}
    >
      {RATIO_ORDER.map((value) => {
        const isSelected = aspectRatio === value;
        const isRatioTall = value === RATIO.PORTRAIT;

        return (
          <button
            key={value}
            onClick={() => onAspectRatioChange(value)}
            className={`
              relative flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-all
              coarse-pointer:min-h-11 coarse-pointer:min-w-11
              ${isSelected
                ? 'bg-purple-600 ring-2 ring-purple-400'
                : 'bg-gray-800 hover:bg-gray-700 border border-gray-600'
              }
            `}
            title={`${value} ${ratioLabel(value)}`}
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
              {value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
